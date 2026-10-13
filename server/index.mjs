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
import { BrandError, cloneSnapshot, createBrands, snapshotIntoProject } from "./brands.mjs";
import { cutOut as defaultCutOut } from "./cutout.mjs";
import { SetError, createConceptSets } from "./concept-sets.mjs";
import { ExportError, JPEG_BUDGET, PLATFORM_EXPORTS, asciiSlug, renderJpg, writeZip } from "./exports.mjs";
import { KitError, discoverKits, findKit, importKitInto, kitFilePath, kitSummary, suggestedBrief } from "./kits.mjs";
import { validateDesignFile } from "./design-files.mjs";
import { PathError, isProjectId, isSafeLeaf } from "./paths.mjs";
import { isFaceId, readAllFaces, usable } from "./face-pack.mjs";
import { EXPORT_SCALES, FACE_SOURCES, MAX_EXPORT_EDGE, MAX_SIDE, MIN_SIDE, PHOTO_ASPECTS, PLATFORMS, PRESETS, THUMBNAIL_FORMATS, allowedScales, briefPlatforms, presetById, thumbnailFormat } from "./presets/index.mjs";
import { RenderError, renderHtml } from "./renderer.mjs";
import { StoreError, createStore } from "./store.mjs";
import { FaceError, createFaces } from "./faces.mjs";

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
  ".zip": "application/zip",
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
export function createServer(config = loadConfig(), deps = {}) {
  const cutOut = deps.cutOut ?? defaultCutOut;
  const store = createStore(config.projectsDir);
  const seriesStore = createSeriesStore(config.dataDir);
  const brands = createBrands({ config });
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
    sets.onProjectEvent(id, event, data);
  };
  const heartbeat = setInterval(() => {
    for (const set of subscribers.values()) for (const res of set) res.write(": heartbeat\n\n");
    sets.heartbeat();
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

  /**
   * Takes the project's turn slot, writes `running` and starts the turn in the background. Resolves once
   * the turn is under way with `done`, which settles with the turn's result (it never rejects).
   */
  async function beginTurn(id, { text, mode = "standard", modelKey = "opus", concept = null }) {
    if (busy(id)) throw new HttpError(409, "TURN_RUNNING", "A turn is already running for this project.");
    const slot = takeSlot(id);
    try {
      // `running` is on disk before the 202, so a reload right after sending never sees an idle project.
      await store.mutate(id, (p) => void (p.running = true));
    } catch (error) {
      slot.finish();
      throw error;
    }
    const done = runTurn({ config, store, id, text, mode, modelKey, concept, emit: (e, d2) => emit(id, e, d2), signal: slot.controller.signal, release: slot.release })
      .catch((error) => {
        emit(id, "run.error", { code: "EXITED", message: error.message });
        return { ok: false, failure: { code: "EXITED", message: error.message }, costUsd: 0 };
      })
      .then(async (result) => {
        await store.mutate(id, (p) => void (p.running = false)).catch(() => {});
        return result;
      })
      .finally(() => {
        slot.finish();
        capabilities.invalidate();
      });
    return { done };
  }

  const faces = createFaces({ config, cutOutFile: deps.cutOutFile });
  const sets = createConceptSets({
    faces,
    brands,
    config,
    store,
    createProject: (body, opts) => createProject(body, opts),
    startTurn: async (id, opts) => (await beginTurn(id, opts)).done,
    abortProject: (id) => turns.get(id)?.controller.abort(),
    cutOut,
  });

  // ---- API ---------------------------------------------------------------------------------

  const packReadyCount = async () => (await readAllFaces(config.dataDir)).filter(usable).length;

  /** The thumbnail brief from what the form sent, with a kit's suggestions filling the blanks. */
  function thumbnailBrief(given, kit, packReady = 0) {
    const suggested = kit ? suggestedBrief(kit.kit) : {};
    const merged = {};
    for (const key of ["title", "channelColours", "notes", "format"]) merged[key] = cleanText(given[key], 4000) || suggested[key] || "";
    const format = merged.format || "video";
    const chosen = thumbnailFormat(format);
    if (!chosen) throw new HttpError(400, "BAD_FORMAT", `format must be one of ${THUMBNAIL_FORMATS.map((f) => f.id).join(", ")}.`);
    // Where the face comes from. Left out, it is the owner's pack whenever the pack has a ready face, else the video's own frames.
    let faceSource = given.faceSource;
    if (faceSource === undefined || faceSource === null || faceSource === "") faceSource = packReady > 0 ? "pack" : "video";
    if (!FACE_SOURCES.includes(faceSource)) throw new HttpError(400, "BAD_FACE_SOURCE", `faceSource must be one of ${FACE_SOURCES.join(", ")}.`);
    if (faceSource === "pack" && packReady === 0) throw new HttpError(400, "NO_PACK_FACES", "The face pack has no ready faces yet; choose the video's frames or let Claude decide.");
    const brief = { title: merged.title, channelColours: merged.channelColours, notes: merged.notes, format, faceSource };
    if (given.platforms !== undefined) {
      if (!Array.isArray(given.platforms)) throw new HttpError(400, "BAD_PLATFORMS", `platforms must be a list of ${Object.keys(PLATFORMS).join(", ")}.`);
      if (format === "shorts") brief.platforms = briefPlatforms(given);
    }
    return { brief, size: { width: chosen.width, height: chosen.height } };
  }

  async function kitFor(id) {
    return findKit(config.fabulaRoots, id);
  }

  /** `opts`: kit (an entry already resolved), sheetFrom, extra (project.json fields), cloneFrom (a project to copy kit material from). */
  async function createProject(body, opts = {}) {
    const preset = presetById(body.preset);
    if (!preset) throw new HttpError(400, "BAD_PRESET", `preset must be one of ${PRESETS.map((p) => p.id).join(", ")}.`);
    let kit = opts.kit ?? null;
    if (!kit && body.kit !== undefined && body.kit !== null) {
      if (preset.id !== "thumbnail") throw new HttpError(400, "BAD_KIT", "A Fabula kit is for thumbnails.");
      kit = await kitFor(body.kit);
    }
    const brief = {};
    const given = body.brief && typeof body.brief === "object" ? body.brief : {};
    let size = preset.defaultSize ?? { width: 1280, height: 720 };
    let extra = { ...opts.extra };
    if (preset.id === "thumbnail") {
      const made = thumbnailBrief(given, kit, await packReadyCount());
      Object.assign(brief, made.brief);
      size = made.size;
    } else for (const field of preset.briefFields) brief[field.id] = cleanText(given[field.id], 4000);
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
      extra = { ...extra, sizeAuto: true };
    }
    const title = cleanText(body.title, 80) || cleanText(Object.values(brief)[0], 60) || preset.label;
    let seriesId = null;
    if (body.series !== undefined && body.series !== null) {
      seriesId = await knownSeries(body.series);
      extra = { ...extra, series: seriesId };
    }
    // A brand is named by id ("none", null or nothing: no brand) and snapshotted into the project, so editing it later changes nothing here.
    // A caller that makes several projects from one brand (a concept set) resolves it once and passes it in `opts.brand`.
    const wanted = body.brand;
    const brand = opts.brand ?? (opts.cloneFrom || wanted === undefined || wanted === null || wanted === "" || wanted === "none" ? null : await brands.resolve(wanted));
    const created = await store.create({ preset: preset.id, title, size, brief, extra });
    try {
      if (kit) await importKitInto(config, store, created.id, kit, { sheetFrom: opts.sheetFrom, faceSource: brief.faceSource });
      else if (opts.cloneFrom) {
        await cloneKitMaterial(opts.cloneFrom, created.id);
        await cloneSnapshot(store, opts.cloneFrom, created.id);
      }
      if (brand) await snapshotIntoProject(store, created.id, brand.brand, brand.dir);
    } catch (error) {
      await store.remove(created.id).catch(() => {});
      throw error;
    }
    if (seriesId) await ensureReference(created.id, seriesId);
    return kit || opts.cloneFrom || brand ? store.read(created.id) : created;
  }

  /** Copies a donor project's kit images, uploads and kit.json into another project (for "another concept"). */
  async function cloneKitMaterial(donorId, id) {
    const donor = await store.read(donorId);
    const keep = donor.assets.filter((a) => a.kind === "kit" || a.kind === "upload");
    const from = store.dirOf(donorId);
    const to = store.dirOf(id);
    for (const a of keep) await fs.promises.copyFile(path.join(from, "assets", a.name), path.join(to, "assets", a.name));
    await fs.promises.mkdir(path.join(to, "reference"), { recursive: true });
    await fs.promises.copyFile(path.join(from, "reference", "kit.json"), path.join(to, "reference", "kit.json")).catch(() => {});
    await store.mutate(id, (p) => {
      p.assets = structuredClone(keep);
      if (donor.kit) p.kit = donor.kit;
    });
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
      await cloneSnapshot(store, id, created.id); // the new episode keeps the source's brand, as it was snapshotted
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

  // ---- concept sets ------------------------------------------------------------------------

  async function uploadBytes(req) {
    if (!req.headers["x-filename"]) throw new HttpError(400, "MISSING_FILENAME", "Uploads need an x-filename header.");
    const type = contentType(req);
    if (type && type !== "application/octet-stream" && !["image/png", "image/jpeg", "image/webp"].includes(type)) throw new HttpError(415, "BAD_CONTENT_TYPE", "Send the image with its own type or application/octet-stream.");
    return { filename: decodeHeader(req.headers["x-filename"]), bytes: await readBody(req, MAX_UPLOAD_BYTES) };
  }

  /** Test & Compare: each chosen concept's current design at 3840x2160 JPG, under 2 MB, in one zip. */
  async function testCompare(id, body) {
    const set = await sets.view(id);
    if (!set.testCompare) throw new HttpError(400, "NOT_VIDEO", "Test & Compare is for 16:9 video thumbnails; Shorts are not eligible.");
    const ready = set.concepts.filter((c) => !c.removed && c.current > 0);
    let chosen = ready;
    if (body.projects !== undefined) {
      if (!Array.isArray(body.projects) || !body.projects.every(isProjectId)) throw new HttpError(400, "BAD_IDS", "projects must be a list of project ids.");
      chosen = ready.filter((c) => body.projects.includes(c.projectId));
    }
    if (!chosen.length) throw new HttpError(409, "NO_RENDERS", "None of the concepts has a render yet.");
    if (chosen.length > 3) throw new HttpError(400, "TOO_MANY", "YouTube compares at most three thumbnails; choose up to three concepts.");
    if (chosen.some((c) => busy(c.projectId))) throw new HttpError(409, "TURN_RUNNING", "A concept is still being designed; export after it finishes.");
    const dir = path.join(sets.dirOf(id), "exports");
    await fs.promises.rm(dir, { recursive: true, force: true });
    await fs.promises.mkdir(dir, { recursive: true });
    const files = [];
    for (const [n, c] of chosen.entries()) {
      const name = `thumbnail-${n + 1}-${asciiSlug(c.label ?? c.title, "concept")}.jpg`;
      const out = await renderJpg(config, store, c.projectId, { width: 3840, out: path.join(dir, name) });
      files.push({ name, project: c.projectId, width: out.width, height: out.height, bytes: out.bytes, quality: out.quality, overBudget: out.overBudget });
    }
    const zipName = `${id}-test-and-compare.zip`.slice(-120).replace(/^[^A-Za-z0-9]+/, "");
    const bytes = await writeZip(path.join(dir, zipName), files.map((f) => ({ name: f.name, file: path.join(dir, f.name) })));
    for (const f of files) await fs.promises.rm(path.join(dir, f.name), { force: true });
    return { name: zipName, url: `/concept-sets/${id}/exports/${zipName}`, bytes, files };
  }

  async function facesApi(req, res, b, c) {
    const method = req.method;
    if (!b) {
      if (method === "GET") return sendJson(res, 200, await faces.list());
      if (method === "POST") {
        const { filename, bytes } = await uploadBytes(req);
        return sendJson(res, 201, await faces.add(filename, bytes));
      }
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }
    if (b === "settings") {
      if (method === "GET") return sendJson(res, 200, await faces.settings());
      if (method === "PUT") return sendJson(res, 200, await faces.setSettings(await readJson(req)));
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }
    if (b === "reclassify") {
      if (method !== "POST") throw new HttpError(405, "METHOD", "Method not allowed.");
      const body = await readJson(req);
      if (body.ids !== undefined && !(Array.isArray(body.ids) && body.ids.length <= 500 && body.ids.every(isFaceId))) throw new HttpError(400, "BAD_IDS", "ids must be a list of face ids.");
      return sendJson(res, 200, await faces.reclassify(body.ids));
    }
    if (!isFaceId(b)) throw new HttpError(400, "BAD_ID", "Invalid face id.");
    if (!c) {
      if (method === "GET") return sendJson(res, 200, await faces.get(b));
      if (method === "PATCH") return sendJson(res, 200, await faces.patch(b, await readJson(req)));
      if (method === "DELETE") return sendJson(res, 200, await faces.trash(b));
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }
    if (method !== "POST") throw new HttpError(405, "METHOD", "Method not allowed.");
    if (c === "restore") return sendJson(res, 200, await faces.restore(b));
    if (c === "recut") return sendJson(res, 202, await faces.recut(b));
    throw new HttpError(404, "NOT_FOUND", "Unknown API route.");
  }

  async function conceptApi(req, res, b, c) {
    const method = req.method;
    if (!b) {
      if (method !== "POST") throw new HttpError(405, "METHOD", "Method not allowed.");
      const body = await readJson(req);
      const count = body.count ?? 3;
      if (!Number.isInteger(count) || count < 2 || count > 4) throw new HttpError(400, "BAD_COUNT", "A concept set holds 2 to 4 concepts; for one design make an ordinary project.");
      const kit = body.kit !== undefined && body.kit !== null ? await kitFor(body.kit) : null;
      const given = body.brief && typeof body.brief === "object" ? body.brief : {};
      const { brief } = thumbnailBrief(given, kit, await packReadyCount());
      const title = cleanText(body.title, 80) || brief.title || "Thumbnails";
      if (!brief.title) throw new HttpError(400, "NEEDS_TITLE", "A concept set needs a title or topic.");
      const brand = body.brand === undefined || body.brand === null || body.brand === "" || body.brand === "none" ? null : await brands.resolve(body.brand);
      const set = await sets.create({ title, brief, kit, count, format: brief.format, brand, createProject });
      return sendJson(res, 201, await sets.view(set.id));
    }
    if (!isProjectId(b)) throw new HttpError(400, "BAD_ID", "Invalid concept set id.");
    if (!c) {
      if (method === "GET") return sendJson(res, 200, await sets.view(b));
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }
    if (c === "events" && method === "GET") {
      const off = await sets.subscribe(b, res);
      req.on("close", off);
      return undefined;
    }
    if (method !== "POST") throw new HttpError(405, "METHOD", "Method not allowed.");
    if (c === "assets") {
      const { filename, bytes } = await uploadBytes(req);
      return sendJson(res, 201, await sets.addUpload(b, filename, bytes, saveUpload));
    }
    if (c === "start") return sendJson(res, 202, await sets.start(b));
    if (c === "cancel") return sendJson(res, 200, await sets.cancel(b));
    if (c === "another") return sendJson(res, 202, await sets.another(b));
    if (c === "test-compare") return sendJson(res, 200, await testCompare(b, await readJson(req)));
    throw new HttpError(404, "NOT_FOUND", "Unknown API route.");
  }

  async function brandsApi(req, res, b, c, d) {
    const method = req.method;
    if (!b) {
      if (method === "GET") return sendJson(res, 200, await brands.list());
      if (method === "POST") return sendJson(res, 201, await brands.create(await readJson(req)));
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }
    if (!isProjectId(b)) throw new HttpError(400, "BAD_ID", "Invalid brand id.");
    if (!c) {
      if (method === "GET") return sendJson(res, 200, await brands.get(b));
      if (method === "PATCH") return sendJson(res, 200, await brands.update(b, await readJson(req)));
      if (method === "DELETE") {
        await brands.remove(b);
        return sendJson(res, 200, { ok: true });
      }
      throw new HttpError(405, "METHOD", "Method not allowed.");
    }
    if (c !== "assets") throw new HttpError(404, "NOT_FOUND", "Unknown API route.");
    if (!d) {
      if (method !== "POST") throw new HttpError(405, "METHOD", "Method not allowed.");
      await brands.get(b);
      const { filename, bytes } = await uploadBytes(req);
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      return sendJson(res, 201, await brands.addAsset(b, filename, bytes, { kind: query.get("kind") ?? undefined, note: query.get("note") ?? undefined }));
    }
    if (!isSafeLeaf(d)) throw new HttpError(400, "BAD_NAME", "Invalid asset name.");
    if (method === "PATCH") return sendJson(res, 200, await brands.updateAsset(b, d, await readJson(req)));
    if (method === "DELETE") {
      await brands.removeAsset(b, d);
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(405, "METHOD", "Method not allowed.");
  }

  /** Vertical covers: YouTube Shorts 2160x3840, Reels and TikTok 1080x1920, JPG under 2 MB; several make a zip. */
  async function platformExport(id, body) {
    if (busy(id)) throw new HttpError(409, "TURN_RUNNING", "A turn is running; export after it finishes.");
    const p = await project(id);
    if (p.preset !== "thumbnail" || p.size.width !== 720 || p.size.height !== 1280) throw new HttpError(400, "NOT_SHORTS", "Platform covers are for vertical (Shorts) thumbnails.");
    if (!p.current) throw new HttpError(409, "NO_RENDERS", "There is no render to export yet.");
    let wanted = body.platforms;
    if (wanted === undefined || wanted === null) wanted = briefPlatforms(p.brief).length ? briefPlatforms(p.brief) : Object.keys(PLATFORM_EXPORTS);
    if (!Array.isArray(wanted) || !wanted.length || !wanted.every((x) => Object.hasOwn(PLATFORM_EXPORTS, x))) throw new HttpError(400, "BAD_PLATFORMS", `platforms must be some of ${Object.keys(PLATFORM_EXPORTS).join(", ")}.`);
    wanted = [...new Set(wanted)];
    const dir = path.join(store.dirOf(id), "exports");
    const files = [];
    const byWidth = new Map();
    for (const platform of wanted) {
      const target = PLATFORM_EXPORTS[platform];
      const name = `${id}-v${p.current}-${platform}-${target.width}x${target.height}.jpg`.slice(-120).replace(/^[^A-Za-z0-9]+/, "");
      // Reels and TikTok are the same pixels; render once.
      if (byWidth.has(target.width)) await fs.promises.copyFile(path.join(dir, byWidth.get(target.width)), path.join(dir, name));
      else {
        const out = await renderJpg(config, store, id, { width: target.width, out: path.join(dir, name) });
        byWidth.set(target.width, name);
        files.push({ platform, name, width: out.width, height: out.height, bytes: out.bytes, quality: out.quality, overBudget: out.overBudget });
        continue;
      }
      const stat = await fs.promises.stat(path.join(dir, name));
      const first = files.find((f) => f.name === byWidth.get(target.width));
      files.push({ platform, name, width: target.width, height: target.height, bytes: stat.size, quality: first?.quality ?? 92, overBudget: stat.size > JPEG_BUDGET });
    }
    if (files.length === 1) return { ...files[0], url: `/projects/${id}/exports/${files[0].name}`, files };
    const zipName = `${id}-v${p.current}-covers.zip`.slice(-120).replace(/^[^A-Za-z0-9]+/, "");
    const bytes = await writeZip(path.join(dir, zipName), files.map((f) => ({ name: `${f.platform}-${f.width}x${f.height}.jpg`, file: path.join(dir, f.name) })));
    return { name: zipName, url: `/projects/${id}/exports/${zipName}`, bytes, width: null, height: null, files };
  }

  async function api(req, res, url, segs) {
    const method = req.method;
    const [, , a, b, c, d] = segs; // ["", "api", ...]
    if (a === "health" && method === "GET") return sendJson(res, 200, { ok: true, version: packageVersion() });
    if (a === "capabilities" && method === "GET") return sendJson(res, 200, await capabilities.get());
    if (a === "presets" && method === "GET") return sendJson(res, 200, PRESETS);
    if (a === "fonts" && method === "GET") return sendFile(res, path.join(config.fontsDir, "fonts.json"));
    if (a === "series") return seriesApi(req, res, b, c);
    if (a === "kits" && method === "GET" && !b) {
      const { found, rejected } = await discoverKits(config.fabulaRoots);
      return sendJson(res, 200, { items: found.map(kitSummary), rejected });
    }
    if (a === "concept-sets") return conceptApi(req, res, b, c);
    if (a === "faces") return facesApi(req, res, b, c);
    if (a === "brands") return brandsApi(req, res, b, c, d);
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
      await beginTurn(id, { text, mode, modelKey });
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

    if (c === "platform-export" && method === "POST") return sendJson(res, 200, await platformExport(id, await readJson(req)));

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
    if (area === "exports" && file && !extra && /\.zip$/i.test(file)) {
      if (!isSafeLeaf(file)) throw new PathError("unsafe file name");
      return sendFile(res, path.join(dir, area, file), { "content-security-policy": FILE_CSP, "content-disposition": `attachment; filename="${file}"` });
    }
    if (["assets", "renders", "exports"].includes(area) && file && !extra) {
      if (!isSafeLeaf(file)) throw new PathError("unsafe file name");
      // Only images are served from these folders (sidecars, stray html or svg are not).
      if (!IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) throw new HttpError(404, "NOT_FOUND", "Not found.");
      return sendFile(res, path.join(dir, area, file), { "content-security-policy": FILE_CSP });
    }
    throw new HttpError(404, "NOT_FOUND", "Not found.");
  }

  /** A kit's images, read-only and image-only, only the files its kit.json declares. */
  async function kitFiles(res, segs) {
    // ["", "kits", id, folder, leaf]
    const [, , id, folder, leaf, extra] = segs;
    if (!id || !folder || !leaf || extra || !isSafeLeaf(leaf) || !["frames", "pictures"].includes(folder)) throw new HttpError(404, "NOT_FOUND", "Not found.");
    if (!IMAGE_EXTENSIONS.has(path.extname(leaf).toLowerCase())) throw new HttpError(404, "NOT_FOUND", "Not found.");
    const entry = await kitFor(id).catch(() => null);
    const real = entry && kitFilePath(entry, `${folder}/${leaf}`);
    if (!real) throw new HttpError(404, "NOT_FOUND", "Not found.");
    return sendFile(res, real, { "content-security-policy": FILE_CSP });
  }

  /** The face pack's images: the original, the cut-out and its thumbnail, as images only. */
  async function faceFiles(res, segs) {
    // ["", "faces", id, file]
    const [, , id, leaf, extra] = segs;
    if (!id || !leaf || extra || !isSafeLeaf(leaf) || !IMAGE_EXTENSIONS.has(path.extname(leaf).toLowerCase())) throw new HttpError(404, "NOT_FOUND", "Not found.");
    const file = await faces.servable(id, leaf);
    if (!file) throw new HttpError(404, "NOT_FOUND", "Not found.");
    return sendFile(res, file, { "content-security-policy": FILE_CSP });
  }

  /** A brand's declared assets, as images only. */
  async function brandFiles(res, segs) {
    // ["", "brands", id, "assets", leaf]
    const [, , id, area, leaf, extra] = segs;
    if (!id || area !== "assets" || !leaf || extra || !isSafeLeaf(leaf) || !IMAGE_EXTENSIONS.has(path.extname(leaf).toLowerCase())) throw new HttpError(404, "NOT_FOUND", "Not found.");
    const file = await brands.servable(id, leaf);
    if (!file) throw new HttpError(404, "NOT_FOUND", "Not found.");
    return sendFile(res, file, { "content-security-policy": FILE_CSP });
  }

  /** A set's finished export zip. */
  async function setExports(res, segs) {
    // ["", "concept-sets", id, "exports", file]
    const [, , id, area, file, extra] = segs;
    if (!isProjectId(id) || area !== "exports" || !file || extra || !isSafeLeaf(file) || !/\.zip$/i.test(file)) throw new HttpError(404, "NOT_FOUND", "Not found.");
    return sendFile(res, path.join(sets.dirOf(id), "exports", file), { "content-security-policy": FILE_CSP, "content-disposition": `attachment; filename="${file}"` });
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
      if (segs[1] === "kits") return await kitFiles(res, segs);
      // /brands alone is the UI page; only /brands/<id>/assets/<file> is a file.
      if (segs[1] === "brands" && segs[2]) return await brandFiles(res, segs);
      // /faces alone is the UI page; only /faces/<id>/... is a file.
      if (segs[1] === "faces" && segs[2]) return await faceFiles(res, segs);
      if (segs[1] === "concept-sets") return await setExports(res, segs);
      if (segs[1] === "fonts" && segs[2] && !segs[3]) {
        if (!isSafeLeaf(segs[2])) throw new PathError("unsafe file name");
        // Designs preview in a sandboxed (opaque-origin) frame, whose font loads are cross-origin requests.
        return await sendFile(res, path.join(config.fontsDir, segs[2]), { "access-control-allow-origin": "*" });
      }
      return await webFiles(res, url.pathname);
    } catch (error) {
      const known = error instanceof HttpError || error instanceof StoreError || error instanceof UploadError || error instanceof SeriesError || error instanceof StyleReferenceError || error instanceof KitError || error instanceof SetError || error instanceof FaceError || error instanceof BrandError || error instanceof ExportError;
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
    sets,
    faces,
    config,
    capabilities,
    async listen(port = config.port, host = config.host) {
      await store.clearStaleRunning();
      await sets.recover();
      await faces.recover();
      await store.purgeTrash().catch(() => {});
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address().port;
    },
    async close() {
      clearInterval(heartbeat);
      sets.abortAll();
      faces.close();
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

