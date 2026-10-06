import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IMAGE_EXTENSIONS, MAX_UPLOAD_BYTES, UploadError, creditsFor, registerCutout, saveUpload } from "./assets.mjs";
import { createCapabilities } from "./capabilities.mjs";
import { FURTHER_DIRECTION, runTurn } from "./claude-runner.mjs";
import { loadConfig, packageVersion } from "./config.mjs";
import { StyleReferenceError, copyStyleReference, hasReference, queryProjects } from "./library.mjs";
import { SeriesError, createSeriesStore } from "./series.mjs";
import { createZipWriter } from "./zip.mjs";
import { cutOut } from "./cutout.mjs";
import { validateDesignFile } from "./design-files.mjs";
import { PathError, isProjectId, isSafeLeaf } from "./paths.mjs";
import { EXPORT_SCALES, MAX_EXPORT_EDGE, MAX_SIDE, MIN_SIDE, PHOTO_ASPECTS, PRESETS, THUMBNAIL_FORMATS, allowedScales, presetById, thumbnailFormat } from "./presets/index.mjs";
import { RenderError, renderHtml } from "./renderer.mjs";
import { StoreError, createStore } from "./store.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};
const DESIGN_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'";
// Anything else from a project folder (images only): inert, whatever its bytes turn out to be.
const FILE_CSP = "sandbox; default-src 'none'";
const APP_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'";

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sendJson = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
  res.end(text);
};

async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"]);
  if (declared > limit) throw new HttpError(413, "TOO_LARGE", `The body is larger than ${Math.round(limit / 1048576)} MB.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "TOO_LARGE", `The body is larger than ${Math.round(limit / 1048576)} MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const contentType = (req) => String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

async function readJson(req) {
  const raw = (await readBody(req, 1_000_000)).toString("utf8");
  if (!raw.trim()) return {};
  // A cross-origin page can only send "simple" content types without a preflight; JSON is not one.
  if (contentType(req) !== "application/json") throw new HttpError(415, "BAD_CONTENT_TYPE", "The request body must be sent as application/json.");
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // Falls through to the error below.
  }
  throw new HttpError(400, "BAD_JSON", "The request body must be a JSON object.");
}

const dimension = (n) => Number.isInteger(n) && n >= MIN_SIDE && n <= MAX_SIDE;
const cleanText = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A loopback-only server; `createServer(config)` returns {server, listen, close, port}. */
export function createServer(config = loadConfig()) {
  const store = createStore(config.projectsDir);
  const seriesStore = createSeriesStore(config.dataDir);
  const capabilities = createCapabilities(config);
  // id -> {controller, done, active}: the running turn (or a restore holding the slot) and its
  // completion. `active` goes false when the slot is released (just before the turn's last event, so
  // an export sent on seeing run.finished is accepted); `done` settles when everything has finished.
  const turns = new Map();
  const busy = (id) => turns.get(id)?.active === true;
  function takeSlot(id) {
    let finish;
    const entry = { controller: new AbortController(), active: true, done: new Promise((resolve) => (finish = resolve)) };
    entry.release = () => {
      entry.active = false;
    };
    entry.finish = () => {
      entry.active = false;
      if (turns.get(id) === entry) turns.delete(id);
      finish();
    };
    turns.set(id, entry);
    return entry;
  }
  const subscribers = new Map();

  const emit = (id, event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of subscribers.get(id) ?? []) res.write(frame);
  };
  const heartbeat = setInterval(() => {
    for (const set of subscribers.values()) for (const res of set) res.write(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref();

  const project = async (id) => store.read(id);

  async function sendFile(res, file, extra = {}) {
    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      throw new HttpError(404, "NOT_FOUND", "Not found.");
    }
    if (!stat.isFile()) throw new HttpError(404, "NOT_FOUND", "Not found.");
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": stat.size,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    });
    fs.createReadStream(file).pipe(res);
  }

  // ---- API ---------------------------------------------------------------------------------

  async function createProject(body) {
    const preset = presetById(body.preset);
    if (!preset) throw new HttpError(400, "BAD_PRESET", `preset must be one of ${PRESETS.map((p) => p.id).join(", ")}.`);
    const brief = {};
    const given = body.brief && typeof body.brief === "object" ? body.brief : {};
    for (const field of preset.briefFields) brief[field.id] = cleanText(given[field.id], 4000);
    let size = preset.defaultSize ?? { width: 1280, height: 720 };
    let extra = {};
    if (preset.id === "thumbnail") {
      const format = cleanText(given.format, 10) || "video";
      const chosen = thumbnailFormat(format);
      if (!chosen) throw new HttpError(400, "BAD_FORMAT", `format must be one of ${THUMBNAIL_FORMATS.map((f) => f.id).join(", ")}.`);
      brief.format = format;
      size = { width: chosen.width, height: chosen.height };
    }
    const asked = body.size;
    if (preset.id === "thumbnail") {
      // The format decides the canvas; a size in the body is ignored, not validated.
    } else if (asked !== undefined && asked !== null) {
      if (!dimension(asked.width) || !dimension(asked.height)) throw new HttpError(400, "BAD_SIZE", `size needs integer width and height from ${MIN_SIDE} to ${MAX_SIDE}.`);
      size = { width: asked.width, height: asked.height };
    } else if (preset.id === "photo") {
      const aspect = cleanText(given.aspect, 10) || "original";
      if (!PHOTO_ASPECTS.includes(aspect)) throw new HttpError(400, "BAD_ASPECT", `aspect must be one of ${PHOTO_ASPECTS.join(", ")}.`);
      brief.aspect = aspect;
      extra = { sizeAuto: true };
    }
    const title = cleanText(body.title, 80) || cleanText(Object.values(brief)[0], 60) || preset.label;
    let seriesId = null;
    if (body.series !== undefined && body.series !== null) {
      seriesId = await knownSeries(body.series);
      extra = { ...extra, series: seriesId };
    }
    const created = await store.create({ preset: preset.id, title, size, brief, extra });
    if (seriesId) await ensureReference(created.id, seriesId);
    return created;
  }

  /** A series id that exists, or 400 BAD_SERIES. */
  async function knownSeries(value) {
    if (typeof value !== "string" || !isProjectId(value) || !(await seriesStore.get(value))) throw new HttpError(400, "BAD_SERIES", "There is no such series.");
    return value;
  }

  /** A project joining a series that has a style project gets that project's look as its reference (best effort). */
  async function ensureReference(id, seriesId) {
    try {
      const series = await seriesStore.get(seriesId);
      const style = series?.styleProjectId;
      if (!style || style === id || (await hasReference(store, id))) return;
      await copyStyleReference(store, style, id);
    } catch {
      // The style project may be gone or unrendered; the series then simply has no reference for this project.
    }
  }

  async function setSeries(id, seriesId) {
    await store.mutate(id, (p) => void (p.series = seriesId), { touch: false });
    if (seriesId) await ensureReference(id, seriesId);
  }

  /** The series a "new in this style" project joins: the source's own, or a new one named after it. */
  async function seriesForStyle(source) {
    const own = source.series ? await seriesStore.get(source.series) : null;
    if (own) return own;
    let made;
    try {
      made = await seriesStore.create({ name: source.title, styleProjectId: source.id });
    } catch (error) {
      if (!(error instanceof SeriesError) || error.code !== "EXISTS") throw error;
      made = (await seriesStore.list()).find((s) => s.name.toLowerCase() === source.title.trim().toLowerCase());
      if (!made) throw error;
    }
    await store.mutate(source.id, (p) => void (p.series = made.id), { touch: false });
    return made;
  }

  const CHANNEL_FIELDS = new Set(["channelColours"]);

  async function newInStyle(id, body) {
    const source = await project(id);
    if (busy(id)) throw new HttpError(409, "TURN_RUNNING", "A turn is running; try again after it finishes.");
    if (!source.current) throw new StyleReferenceError("That project has no render yet, so there is nothing to copy the style from.");
    await fs.promises.access(path.join(store.dirOf(id), "renders", `v${source.current}.png`)).catch(() => {
      throw new StyleReferenceError("That project's render is missing, so there is nothing to copy the style from.");
    });
    const preset = presetById(source.preset);
    const given = body.brief && typeof body.brief === "object" ? body.brief : {};
    // Only channel-level settings carry over. Everything else (title, notes, instruction) is about the
    // source's own episode and would mislead the new one, so it comes from the request or stays empty.
    const brief = {};
    for (const field of preset.briefFields) {
      const carried = CHANNEL_FIELDS.has(field.id) ? String(source.brief?.[field.id] ?? "") : "";
      brief[field.id] = typeof given[field.id] === "string" ? given[field.id] : carried;
    }
    if (source.preset === "thumbnail") brief.format = source.brief?.format ?? "video";
    const series = await seriesForStyle(source);
    const created = await createProject({ preset: source.preset, title: cleanText(body.title, 80) || undefined, size: source.size, brief, series: series.id });
    try {
      await copyStyleReference(store, id, created.id);
    } catch (error) {
      await store.remove(created.id).catch(() => {});
      throw error;
    }
    return store.read(created.id);
  }

  async function seriesApi(req, res, b, c) {
    const method = req.method;
    if (!b) {
      if (method === "GET") {
        const counts = new Map();
        for (const p of await store.summaries()) if (p.series) counts.set(p.series, (counts.get(p.series) ?? 0) + 1);
        return sendJson(res, 200, (await seriesStore.list()).map((s) => ({ ...s, count: counts.get(s.id) ?? 0 })));
      }
      if (method === "POST") {
        const body = await readJson(req);
        if (body.styleProjectId) await project(String(body.styleProjectId)).catch(() => Promise.reject(new HttpError(400, "BAD_STYLE_PROJECT", "styleProjectId is not a project.")));
        return sendJson(res, 201, await seriesStore.create({ name: body.name, styleProjectId: body.styleProjectId }));
      }
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }
    if (!isProjectId(b) || c) throw new HttpError(400, "BAD_ID", "Invalid series id.");
    if (method === "PATCH") {
      const body = await readJson(req);
      if (typeof body.styleProjectId === "string") await project(body.styleProjectId).catch(() => Promise.reject(new HttpError(400, "BAD_STYLE_PROJECT", "styleProjectId is not a project.")));
      return sendJson(res, 200, await seriesStore.update(b, { name: body.name, styleProjectId: body.styleProjectId }));
    }
    if (method === "DELETE") {
      await seriesStore.remove(b);
      // Projects keep their files (and any reference); they just leave the series.
      for (const p of await store.summaries()) if (p.series === b) await store.mutate(p.id, (x) => void (x.series = null), { touch: false }).catch(() => {});
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(405, "METHOD", "Method not allowed.");
  }

  const MAX_BULK = 500;
  const idList = (value) => {
    if (!Array.isArray(value) || !value.length) throw new HttpError(400, "BAD_IDS", "ids must be a non-empty list of project ids.");
    if (value.length > MAX_BULK) throw new HttpError(400, "BAD_IDS", `At most ${MAX_BULK} projects at a time.`);
    if (!value.every(isProjectId)) throw new HttpError(400, "BAD_IDS", "ids must be project ids.");
    return [...new Set(value)];
  };

  async function bulk(body) {
    const action = body.action;
    if (!["delete", "restore", "star", "unstar", "series"].includes(action)) throw new HttpError(400, "BAD_ACTION", "action must be delete, restore, star, unstar or series.");
    const ids = idList(body.ids);
    let seriesId = null;
    if (action === "series" && body.series !== null) seriesId = await knownSeries(body.series);
    const changed = [];
    const missing = [];
    for (const id of ids) {
      try {
        if (action === "restore") {
          if (await store.untrash(id)) changed.push(id);
          else missing.push(id);
          continue;
        }
        await project(id);
        if (action === "delete") {
          const running = turns.get(id);
          running?.controller.abort();
          await running?.done;
          await store.trash(id);
        } else if (action === "series") await setSeries(id, seriesId);
        else await store.mutate(id, (p) => void (p.starred = action === "star"), { touch: false });
        changed.push(id);
      } catch (error) {
        if (error instanceof StoreError && error.status === 404) missing.push(id);
        else throw error;
      }
    }
    return { ok: true, changed, missing };
  }

  async function exportZip(res, url) {
    const ids = idList(String(url.searchParams.get("ids") ?? "").split(",").filter(Boolean));
    const files = [];
    for (const id of ids) {
      let p;
      try {
        p = await project(id);
      } catch {
        continue;
      }
      if (!p.current) continue;
      const file = path.join(store.dirOf(id), "renders", `v${p.current}.png`);
      const slug = String(p.title).normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "design";
      files.push({ file, name: `${slug}-${id}-v${p.current}.png`.slice(-120).replace(/^[^A-Za-z0-9]+/, "") });
    }
    if (!files.length) throw new HttpError(404, "NO_RENDERS", "None of those projects has a render to export.");
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="imago-export.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    const zip = createZipWriter((chunk) => new Promise((resolve) => (res.write(chunk) ? resolve() : res.once("drain", resolve))));
    for (const { file, name } of files) {
      const data = await fs.promises.readFile(file).catch(() => null);
      if (data) await zip.add(name, data);
    }
    await zip.finish();
    res.end();
  }

  async function api(req, res, url, segs) {
    const method = req.method;
    const [, , a, b, c, d] = segs; // ["", "api", ...]
    if (a === "health" && method === "GET") return sendJson(res, 200, { ok: true, version: packageVersion() });
    if (a === "capabilities" && method === "GET") return sendJson(res, 200, await capabilities.get());
    if (a === "presets" && method === "GET") return sendJson(res, 200, PRESETS);
    if (a === "fonts" && method === "GET") return sendFile(res, path.join(config.fontsDir, "fonts.json"));
    if (a === "series") return seriesApi(req, res, b, c);
    if (a !== "projects") throw new HttpError(404, "NOT_FOUND", "Unknown API route.");

    if (!b) {
      if (method === "GET") return sendJson(res, 200, queryProjects(await store.summaries(), url.searchParams));
      if (method === "POST") return sendJson(res, 201, await createProject(await readJson(req)));
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }
    if (b === "bulk") {
      if (method !== "POST") throw new HttpError(405, "METHOD", "Method not allowed.");
      return sendJson(res, 200, await bulk(await readJson(req)));
    }
    if (b === "export.zip") {
      if (method !== "GET") throw new HttpError(405, "METHOD", "Method not allowed.");
      return exportZip(res, url);
    }
    if (!isProjectId(b)) throw new HttpError(400, "BAD_ID", "Invalid project id.");
    const id = b;

    if (!c) {
      if (method === "GET") return sendJson(res, 200, await project(id));
      if (method === "PATCH") {
        const body = await readJson(req);
        await project(id);
        const patch = {};
        if (body.title !== undefined) {
          patch.title = cleanText(body.title, 80);
          if (!patch.title) throw new HttpError(400, "BAD_TITLE", "A project needs a title.");
        }
        if (body.starred !== undefined) {
          if (typeof body.starred !== "boolean") throw new HttpError(400, "BAD_STARRED", "starred must be true or false.");
          patch.starred = body.starred;
        }
        if (body.series !== undefined) patch.series = body.series === null ? null : await knownSeries(body.series);
        const next = await store.mutate(id, (p) => void Object.assign(p, patch), { touch: false });
        if (patch.series) await ensureReference(id, patch.series);
        emit(id, "project", { project: next });
        return sendJson(res, 200, next);
      }
      if (method === "DELETE") {
        await project(id);
        const running = turns.get(id);
        running?.controller.abort();
        await running?.done; // the turn writes project.json until it has finished; wait before removing the folder
        await store.remove(id);
        return sendJson(res, 200, { ok: true });
      }
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }

    if (c === "events" && method === "GET") {
      const snapshot = await project(id);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`retry: 3000\nevent: snapshot\ndata: ${JSON.stringify({ project: snapshot })}\n\n`);
      if (!subscribers.has(id)) subscribers.set(id, new Set());
      subscribers.get(id).add(res);
      req.on("close", () => {
        subscribers.get(id)?.delete(res);
        if (!subscribers.get(id)?.size) subscribers.delete(id);
      });
      return undefined;
    }

    if (c === "assets" && method === "POST" && !d) {
      await project(id);
      // The custom header forces a CORS preflight for any cross-origin page; the type must not be a "simple" one.
      if (!req.headers["x-filename"]) throw new HttpError(400, "MISSING_FILENAME", "Uploads need an x-filename header.");
      const type = contentType(req);
      if (type && type !== "application/octet-stream" && !["image/png", "image/jpeg", "image/webp"].includes(type)) throw new HttpError(415, "BAD_CONTENT_TYPE", "Send the image with its own type or application/octet-stream.");
      const filename = decodeHeader(req.headers["x-filename"]);
      const bytes = await readBody(req, MAX_UPLOAD_BYTES);
      return sendJson(res, 201, await saveUpload(store, id, filename, bytes));
    }
    if (c === "assets" && d && segs[6] === "cutout" && method === "POST") {
      const name = d;
      if (!isSafeLeaf(name)) throw new HttpError(400, "BAD_NAME", "Invalid asset name.");
      await project(id);
      try {
        const result = await cutOut(store.dirOf(id), name);
        await registerCutout(store, id, result);
        emit(id, "project", { project: await project(id) });
        return sendJson(res, 200, { name: result.name, width: result.width, height: result.height });
      } catch (error) {
        throw new HttpError(422, "CUTOUT_FAILED", error.message);
      }
    }

    if (c === "messages" && method === "POST") {
      const body = await readJson(req);
      const mode = body.mode ?? "standard";
      if (mode !== "standard" && mode !== "further") throw new HttpError(400, "BAD_MODE", 'mode must be "standard" or "further".');
      const modelKey = body.model ?? "opus";
      if (mode === "further" && (typeof modelKey !== "string" || !Object.hasOwn(config.furtherModels, modelKey))) {
        throw new HttpError(400, "BAD_MODEL", `model must be one of ${Object.keys(config.furtherModels).join(", ")}.`);
      }
      // "Take it further" may be sent without words; the server supplies the direction.
      const text = cleanText(body.text, 20_000) || (mode === "further" ? FURTHER_DIRECTION : "");
      if (!text) throw new HttpError(400, "EMPTY", "text is required.");
      await project(id);
      if (busy(id)) throw new HttpError(409, "TURN_RUNNING", "A turn is already running for this project.");
      const slot = takeSlot(id);
      try {
        // `running` is on disk before the 202, so a reload right after sending never sees an idle project.
        await store.mutate(id, (p) => void (p.running = true));
      } catch (error) {
        slot.finish();
        throw error;
      }
      runTurn({ config, store, id, text, mode, modelKey, emit: (e, d2) => emit(id, e, d2), signal: slot.controller.signal, release: slot.release })
        .catch((error) => emit(id, "run.error", { code: "EXITED", message: error.message }))
        .then(() => store.mutate(id, (p) => void (p.running = false)).catch(() => {}))
        .finally(() => {
          slot.finish();
          capabilities.invalidate();
        });
      return sendJson(res, 202, { ok: true });
    }

    if (c === "duplicate" && method === "POST" && !d) {
      const source = await project(id);
      if (busy(id)) throw new HttpError(409, "TURN_RUNNING", "A turn is running; duplicate after it finishes.");
      const title = `${source.title.replace(/ \(copy\)$/, "")} (copy)`.slice(0, 80);
      return sendJson(res, 201, await store.duplicate(id, title));
    }

    if (c === "new-in-style" && method === "POST" && !d) return sendJson(res, 201, await newInStyle(id, await readJson(req)));

    if (c === "cancel" && method === "POST") {
      turns.get(id)?.controller.abort();
      return sendJson(res, 200, { ok: true });
    }

    if (c === "restore" && method === "POST") {
      const body = await readJson(req);
      const version = body.version;
      if (!Number.isInteger(version) || version < 1) throw new HttpError(400, "BAD_VERSION", "version must be a positive integer.");
      if (busy(id)) throw new HttpError(409, "TURN_RUNNING", "A turn is running; restore after it finishes.");
      // Take the slot before any await, so a message cannot start a turn halfway through the restore.
      const slot = takeSlot(id);
      try {
        const current = await project(id);
        if (!current.versions.some((v) => v.n === version)) throw new HttpError(404, "NOT_FOUND", `There is no version ${version}.`);
        const dir = store.dirOf(id);
        try {
          await fs.promises.copyFile(path.join(dir, "versions", `v${version}.html`), path.join(dir, "design.html"));
        } catch (error) {
          if (error.code === "ENOENT") throw new HttpError(404, "NOT_FOUND", `versions/v${version}.html is missing.`);
          throw error;
        }
        const next = await store.mutate(id, (p) => void (p.current = version));
        emit(id, "project", { project: next });
        return sendJson(res, 200, next);
      } finally {
        slot.finish();
      }
    }

    if (c === "export" && method === "POST") {
      const body = await readJson(req);
      const format = body.format ?? "png";
      const scale = body.scale ?? 1;
      if (!["png", "jpg", "webp"].includes(format)) throw new HttpError(400, "BAD_FORMAT", "format must be png, jpg or webp.");
      if (!EXPORT_SCALES.includes(scale)) throw new HttpError(400, "BAD_SCALE", "scale must be 1, 1.5, 2 or 3.");
      if (busy(id)) throw new HttpError(409, "TURN_RUNNING", "A turn is running; export after it finishes.");
      const p = await project(id);
      if (!allowedScales(p.size).includes(scale)) throw new HttpError(400, "BAD_SCALE", `At ${scale}× the longest edge would pass ${MAX_EXPORT_EDGE} px; choose ${allowedScales(p.size).at(-1)}× or less.`);
      const { errors } = await validateDesignFile(store.dirOf(id), p.size, config.fontsDir);
      if (errors.length) throw new HttpError(422, "INVALID_DESIGN", errors.join(" "));
      const html = await fs.promises.readFile(path.join(store.dirOf(id), "design.html"), "utf8").catch(() => "");
      const credits = creditsFor(p, html);
      const name = `${id}-v${p.current || 0}-${scale}x.${format}`.slice(-120).replace(/^[^A-Za-z0-9]+/, "");
      const dir = store.dirOf(id);
      try {
        const out = await renderHtml(config, { htmlFile: path.join(dir, "design.html"), ...p.size, scale, format, out: path.join(dir, "exports", name) });
        return sendJson(res, 200, { name, url: `/projects/${id}/exports/${name}`, width: out.width, height: out.height, bytes: out.bytes, credits });
      } catch (error) {
        if (error instanceof RenderError) throw new HttpError(503, "RENDER_FAILED", error.message);
        throw error;
      }
    }
    throw new HttpError(404, "NOT_FOUND", "Unknown API route.");
  }

  // ---- files -------------------------------------------------------------------------------

  async function projectFiles(res, segs, versionBase) {
    // ["", "projects", id, area, ...]
    const [, , id, area, file, extra] = segs;
    if (!isProjectId(id)) throw new HttpError(400, "BAD_ID", "Invalid project id.");
    const dir = store.dirOf(id);
    if (area === "design.html" && !file) return sendFile(res, path.join(dir, "design.html"), { "content-security-policy": DESIGN_CSP });
    if (area === "versions" && file && !extra && /^v\d+\.html$/.test(file)) {
      let html;
      try {
        html = await fs.promises.readFile(path.join(dir, "versions", file), "utf8");
      } catch {
        throw new HttpError(404, "NOT_FOUND", "Not found.");
      }
      // Snapshots live in versions/ but refer to assets/ relative to the project.
      const base = `<base href="${versionBase(id)}">`;
      const body = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${base}`) : `${base}${html}`;
      res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store", "content-security-policy": DESIGN_CSP });
      return res.end(body);
    }
    if (["assets", "renders", "exports"].includes(area) && file && !extra) {
      if (!isSafeLeaf(file)) throw new PathError("unsafe file name");
      // Only images are served from these folders (sidecars, stray html or svg are not).
      if (!IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) throw new HttpError(404, "NOT_FOUND", "Not found.");
      return sendFile(res, path.join(dir, area, file), { "content-security-policy": FILE_CSP });
    }
    throw new HttpError(404, "NOT_FOUND", "Not found.");
  }

  async function webFiles(res, pathname) {
    const root = config.webRoot;
    const clean = pathname.split("/").filter(Boolean);
    if (clean.some((s) => s === ".." || s.startsWith(".") || !/^[\w@.%+-]+$/.test(s))) throw new PathError("unsafe path");
    const file = path.join(root, ...clean);
    try {
      if ((await fs.promises.stat(file)).isFile()) return sendFile(res, file, { "content-security-policy": APP_CSP });
    } catch {
      // Falls back to the app shell below.
    }
    if (path.extname(pathname)) throw new HttpError(404, "NOT_FOUND", "Not found.");
    return sendFile(res, path.join(root, "index.html"), { "content-security-policy": APP_CSP }).catch(() => {
      throw new HttpError(404, "NO_UI", "The UI has not been built. Run npm run build.");
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      // Loopback only: refuse requests that reach us under another name (DNS rebinding).
      const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
      if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new HttpError(403, "FORBIDDEN_HOST", "Only loopback hosts are served.");
      if (req.method !== "GET" && req.method !== "HEAD") {
        // Changing requests must come from this very server (its own page, or the dev server named in
        // IMAGO_ALLOWED_ORIGINS) or from a non-browser client, which sends no Origin at all.
        const origin = req.headers.origin;
        const port = server.address()?.port;
        const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...config.allowedOrigins];
        if (origin !== undefined && !allowed.includes(origin)) throw new HttpError(403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed.");
        const site = req.headers["sec-fetch-site"];
        if (site !== undefined && site !== "same-origin" && site !== "none") throw new HttpError(403, "FORBIDDEN_ORIGIN", "Cross-site requests are not allowed.");
      }
      let segs;
      try {
        segs = url.pathname.split("/").map(decodeURIComponent);
      } catch {
        throw new HttpError(400, "BAD_PATH", "Malformed path.");
      }
      if (segs.some((s) => s.includes("\0") || s.includes("/") || s.includes("\\") || s === "..")) throw new PathError("unsafe path");
      if (segs[1] === "api") return await api(req, res, url, segs);
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "METHOD", "Method not allowed.");
      if (segs[1] === "projects") return await projectFiles(res, segs, (id) => `/projects/${id}/`);
      if (segs[1] === "fonts" && segs[2] && !segs[3]) {
        if (!isSafeLeaf(segs[2])) throw new PathError("unsafe file name");
        // Designs preview in a sandboxed (opaque-origin) frame, whose font loads are cross-origin requests.
        return await sendFile(res, path.join(config.fontsDir, segs[2]), { "access-control-allow-origin": "*" });
      }
      return await webFiles(res, url.pathname);
    } catch (error) {
      const known = error instanceof HttpError || error instanceof StoreError || error instanceof UploadError || error instanceof SeriesError || error instanceof StyleReferenceError;
      const status = known ? error.status : error instanceof PathError ? 400 : 500;
      const code = known ? error.code : error instanceof PathError ? "BAD_PATH" : "INTERNAL";
      if (res.headersSent) return res.end();
      sendJson(res, status, { error: { code, message: known || error instanceof PathError ? error.message : "Internal error." } });
      if (status === 500) console.error(error);
    }
  });

  return {
    server,
    store,
    config,
    capabilities,
    async listen(port = config.port, host = config.host) {
      await store.clearStaleRunning();
      await store.purgeTrash().catch(() => {});
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address().port;
    },
    async close() {
      clearInterval(heartbeat);
      for (const { controller } of turns.values()) controller.abort();
      for (const set of subscribers.values()) for (const res of set) res.end();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function decodeHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "image";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createServer();
  const port = await app.listen();
  console.log(`Imago listening on http://${app.config.host}:${port}`);
  const stop = () => app.close().finally(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

