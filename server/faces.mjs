// The face pack: the owner's own face photos, uploaded once, cut out locally in a background queue and
// labelled by Claude in one turn per batch. Lives at <IMAGO_DATA_DIR>/faces/<id>/ (original.<ext>,
// cutout.png, thumb.png, face.json). The server is the only writer of face.json; the render MCP and the
// concept planner read it through face-pack.mjs.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UploadError } from "./assets.mjs";
import { runFacesClassifier } from "./claude-runner.mjs";
import { cutOutFile as defaultCutOutFile } from "./cutout.mjs";
import { LABEL_FIELDS, isFaceId, measureSharpness, qualityOf, readAllFaces, readSettings, validateLabels } from "./face-pack.mjs";
import { renderFaceSheet } from "./face-sheet.mjs";
import { EXTENSION, MAX_PIXELS, imageInfo, tooManyPixels } from "./image-info.mjs";
import { sanitizeLeaf } from "./paths.mjs";

export class FaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const MAX_FACES = 300;
/** Photos per classification turn: more than this and the contact sheet stops being legible. */
export const BATCH_SIZE = 20;
const THUMB_HEIGHT = 360;
const TRASH_DAYS = 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (text, max = 200) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** `ctx`: {config, cutOutFile?(source, destination) -> {width, height}, classify?({config, dir, count, signal}) -> {ok, costUsd, failure}}. */
export function createFaces(ctx) {
  const { config } = ctx;
  const root = config.facesDir;
  const cutOutFile = ctx.cutOutFile ?? defaultCutOutFile;
  const classify = ctx.classify ?? runFacesClassifier;
  const dirOf = (id) => {
    if (!isFaceId(id)) throw new FaceError("BAD_ID", "Invalid face id.");
    return path.join(root, id);
  };
  const fileOf = (id) => path.join(dirOf(id), "face.json");
  const trashDir = path.join(root, ".trash");
  const queues = new Map();
  const cutQueue = [];
  let cutting = null; // id being cut out
  let classifying = new Set();
  let timer = null;
  let closed = false;
  const abort = new AbortController();
  const activity = { lastRun: null };

  async function read(id) {
    try {
      return JSON.parse(await fs.readFile(fileOf(id), "utf8"));
    } catch (error) {
      if (error instanceof FaceError) throw error;
      if (error.code === "ENOENT") throw new FaceError("NOT_FOUND", "No such face.", 404);
      throw new FaceError("CORRUPT", `face.json could not be read: ${error.message}`, 500);
    }
  }

  /** Read-modify-write one face under its queue; atomic (temp file, then rename). */
  function mutate(id, fn) {
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
      const face = await read(id);
      const next = (await fn(face)) ?? face;
      const tmp = `${fileOf(id)}.${randomBytes(3).toString("hex")}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
      await fs.rename(tmp, fileOf(id));
      return next;
    });
    const tail = run.catch(() => {});
    queues.set(id, tail);
    tail.then(() => queues.get(id) === tail && queues.delete(id));
    return run;
  }

  const stageOf = (face) => {
    const c = face.cutout?.state;
    if (c === "queued") return "queued";
    if (c === "running") return "cutting";
    if (c === "failed") return "failed";
    const k = face.classification?.state;
    if (k === "pending" || k === "running") return "classifying";
    if (k === "unclassified") return "unclassified";
    return "ready";
  };

  function view(face) {
    const base = `/faces/${face.id}`;
    const done = face.cutout?.state === "done";
    return {
      id: face.id,
      addedAt: face.addedAt,
      filename: face.filename,
      stage: stageOf(face),
      error: face.cutout?.state === "failed" ? face.cutout.error ?? "The cut-out failed." : face.classification?.state === "unclassified" ? face.classification.reason ?? "" : "",
      original: { width: face.original.width, height: face.original.height, url: `${base}/${face.original.file}` },
      cutout: { state: face.cutout.state, width: face.cutout.width ?? null, height: face.cutout.height ?? null, url: done ? `${base}/cutout.png` : null, thumbUrl: done ? `${base}/${face.cutout.thumb ? "thumb.png" : "cutout.png"}` : null },
      labels: face.labels ?? null,
      labelsEditedByOwner: face.labelsEditedByOwner === true,
      mirrorAllowed: face.mirrorAllowed === true || face.mirrorAllowed === false ? face.mirrorAllowed : null,
      quality: face.quality ?? null,
      starred: face.starred === true,
      hidden: face.hidden === true,
      classification: { state: face.classification?.state ?? "pending", reason: face.classification?.reason ?? "" },
    };
  }

  // ---- cut-outs: one at a time, in the background -----------------------------------------------

  function enqueueCut(id) {
    if (closed || cutQueue.includes(id) || cutting === id) return;
    cutQueue.push(id);
    void pumpCuts();
  }

  async function pumpCuts() {
    if (cutting || closed) return;
    const id = cutQueue.shift();
    if (!id) {
      scheduleClassify();
      return;
    }
    cutting = id;
    try {
      await cutJob(id);
    } catch {
      // A face removed mid-job; nothing to record.
    } finally {
      cutting = null;
      void pumpCuts();
    }
  }

  async function cutJob(id) {
    const face = await mutate(id, (f) => void (f.cutout = { state: "running" }));
    const dir = dirOf(id);
    let source = path.join(dir, face.original.file);
    const upright = path.join(dir, "upright.png");
    try {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(source, { limitInputPixels: MAX_PIXELS }).metadata();
      // A photo stored sideways by its EXIF flag is cut out upright, so the cut-out and the labels agree.
      if ((meta.orientation ?? 1) > 1) {
        await sharp(source, { limitInputPixels: MAX_PIXELS }).rotate().png().toFile(upright);
        source = upright;
      }
      const tmp = path.join(dir, "cutout.tmp.png");
      const made = await cutOutFile(source, tmp);
      await fs.rename(tmp, path.join(dir, "cutout.png"));
      let thumb = false;
      try {
        await sharp(path.join(dir, "cutout.png"), { limitInputPixels: MAX_PIXELS }).resize({ height: THUMB_HEIGHT, fit: "inside", withoutEnlargement: true }).png().toFile(path.join(dir, "thumb.png"));
        thumb = true;
      } catch {
        // The grid then falls back to the full cut-out.
      }
      await mutate(id, (f) => {
        f.cutout = { state: "done", width: made.width, height: made.height, thumb };
        // A recut face that was labelled before keeps its labels.
        if (!f.labels && f.classification?.state !== "pending") f.classification = { state: "pending" };
      });
    } catch (error) {
      await mutate(id, (f) => {
        f.cutout = { state: "failed", error: short(error.message) || "The cut-out failed." };
        f.classification = { state: "unclassified", reason: "The cut-out failed, so it was not classified." };
      }).catch(() => {});
    } finally {
      await fs.rm(upright, { force: true }).catch(() => {});
      await fs.rm(path.join(dir, "cutout.tmp.png"), { force: true }).catch(() => {});
    }
  }

  // ---- classification: one Claude turn per batch --------------------------------------------------

  const cutBusy = () => cutting !== null || cutQueue.length > 0;

  function scheduleClassify() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void classifyLoop();
    }, config.facesBatchMs ?? 2000);
    timer.unref?.();
  }

  async function pendingIds() {
    const faces = await readAllFaces(path.dirname(root));
    return faces
      .filter((f) => f.cutout?.state === "done" && f.classification?.state === "pending")
      .sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))
      .map((f) => f.id);
  }

  async function classifyLoop() {
    if (classifying.size || closed) return;
    // A cut-out still in progress means more of the batch is coming; the queue draining reschedules.
    if (cutBusy()) return;
    classifying = new Set(["loop"]);
    try {
      for (;;) {
        if (cutBusy() || closed) break;
        const ids = (await pendingIds()).slice(0, BATCH_SIZE);
        if (!ids.length) break;
        await classifyBatch(ids);
      }
    } finally {
      classifying = new Set();
      if (!closed && !cutBusy() && (await pendingIds().catch(() => [])).length) scheduleClassify();
    }
  }

  async function failBatch(ids, reason) {
    for (const id of ids) {
      await mutate(id, (f) => {
        // A face that was labelled before keeps its labels when a Reclassify fails.
        f.classification = f.labels ? { state: "done", reason: "", note: reason } : { state: "unclassified", reason };
      }).catch(() => {});
    }
  }

  async function classifyBatch(ids) {
    classifying = new Set(ids);
    const work = path.join(root, ".work", randomBytes(4).toString("hex"));
    try {
      await fs.mkdir(path.join(work, "images"), { recursive: true });
      const items = [];
      const kept = [];
      const sharp = (await import("sharp")).default;
      for (const id of ids) {
        const face = await read(id).catch(() => null);
        if (!face) continue;
        const n = kept.length + 1;
        const name = `${String(n).padStart(2, "0")}.jpg`;
        try {
          await sharp(path.join(dirOf(id), face.original.file), { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toFile(path.join(work, "images", name));
        } catch (error) {
          await failBatch([id], `The photo could not be read (${short(error.message, 80)}).`);
          continue;
        }
        kept.push(id);
        items.push({ file: path.join(work, "images", name), label: `Photo ${n}` });
      }
      if (!kept.length) return;
      await Promise.all(kept.map((id) => mutate(id, (f) => void (f.classification = { state: "running" })).catch(() => {})));
      const cols = kept.length <= 4 ? kept.length : kept.length <= 12 ? 4 : 5;
      await renderFaceSheet(config, items, { out: path.join(work, "sheet.png"), columns: cols, cell: 240, title: `Photos 1 to ${kept.length}`, checker: false });
      const outcome = await classify({ config, dir: work, count: kept.length, signal: abort.signal });
      activity.lastRun = { at: new Date().toISOString(), ok: outcome.ok, costUsd: outcome.costUsd ?? 0, count: kept.length };
      if (!outcome.ok) return void (await failBatch(kept, outcome.failure?.message ?? "Claude could not classify these photos."));
      let parsed;
      try {
        parsed = JSON.parse(await fs.readFile(path.join(work, "labels.json"), "utf8"));
      } catch {
        return void (await failBatch(kept, "Claude's answer could not be read."));
      }
      const entries = Array.isArray(parsed?.faces) ? parsed.faces : [];
      for (const [i, id] of kept.entries()) {
        const entry = entries.find((e) => e && e.n === i + 1);
        const checked = entry ? validateLabels(entry) : { ok: false, reason: "Claude gave no labels for this photo" };
        if (!checked.ok) {
          await failBatch([id], short(`Not classified: ${checked.reason}.`));
          continue;
        }
        await applyLabels(id, checked.labels);
      }
    } finally {
      classifying = new Set(["loop"]);
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Stores Claude's labels (never over the owner's edits) and grades the face. */
  async function applyLabels(id, labels) {
    try {
      const face = await read(id);
      const box = face.labelsEditedByOwner && face.labels?.faceBox ? face.labels.faceBox : labels.faceBox;
      let sharpness = null;
      try {
        sharpness = await measureSharpness(await fs.readFile(path.join(dirOf(id), face.original.file)), box);
      } catch {
        // Graded on size alone.
      }
      await mutate(id, (f) => {
        if (f.labelsEditedByOwner && f.labels) f.labels = { ...f.labels, faceBox: f.labels.faceBox ?? labels.faceBox };
        else f.labels = labels;
        f.classification = { state: "done", reason: "", at: new Date().toISOString() };
        f.quality = qualityOf({ faceBox: f.labels.faceBox, imageHeight: f.cutout?.height ?? f.original.height, sharpness });
      });
    } catch {
      // Removed meanwhile.
    }
  }

  // ---- the API the server calls -------------------------------------------------------------------

  const api = {
    dirOf,
    read,

    async list() {
      const faces = await readAllFaces(path.dirname(root));
      const items = faces.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)) || b.id.localeCompare(a.id)).map(view);
      const working = items.filter((f) => ["queued", "cutting", "classifying"].includes(f.stage)).length;
      return {
        items,
        counts: { total: items.length, ready: items.filter((f) => f.stage === "ready").length, hidden: items.filter((f) => f.hidden).length, working, unclassified: items.filter((f) => f.stage === "unclassified").length },
        model: config.facesModel,
        settings: await readSettings(path.dirname(root)),
        lastRun: activity.lastRun,
      };
    },

    async settings() {
      return readSettings(path.dirname(root));
    },

    async setSettings(body) {
      if (typeof body.mirrorAll !== "boolean") throw new FaceError("BAD_FLAG", "mirrorAll must be true or false.");
      await fs.mkdir(root, { recursive: true });
      const tmp = path.join(root, `settings.${randomBytes(3).toString("hex")}.tmp`);
      await fs.writeFile(tmp, `${JSON.stringify({ mirrorAll: body.mirrorAll })}\n`);
      await fs.rename(tmp, path.join(root, "settings.json"));
      return { mirrorAll: body.mirrorAll };
    },

    async get(id) {
      return view(await read(id));
    },

    /** Stores an upload (same type, size and megapixel rules as a project asset) and queues its cut-out. */
    async add(filename, bytes) {
      const info = imageInfo(bytes);
      if (!info) throw new UploadError("UNSUPPORTED_IMAGE", "Only PNG, JPEG or WebP images can be uploaded.", 415);
      if (tooManyPixels(info)) throw new UploadError("IMAGE_TOO_LARGE", `Images over ${MAX_PIXELS / 1_000_000} megapixels cannot be used (this one is ${info.width}×${info.height}).`, 413);
      await fs.mkdir(root, { recursive: true });
      if ((await fs.readdir(root)).filter(isFaceId).length >= MAX_FACES) throw new FaceError("PACK_FULL", `The face pack holds at most ${MAX_FACES} photos.`, 409);
      let width = info.width;
      let height = info.height;
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
        if ((meta.orientation ?? 1) >= 5) [width, height] = [height, width];
      } catch {
        // The header sizes stand.
      }
      let id;
      for (let attempt = 0; ; attempt += 1) {
        id = randomBytes(4).toString("hex");
        try {
          await fs.mkdir(dirOf(id));
          break;
        } catch (error) {
          if (error.code !== "EEXIST" || attempt >= 5) throw error;
        }
      }
      const file = `original.${EXTENSION[info.type]}`;
      await fs.writeFile(path.join(dirOf(id), file), bytes, { flag: "wx" });
      const face = {
        schemaVersion: 1,
        id,
        addedAt: new Date().toISOString(),
        filename: sanitizeLeaf(filename, "photo").slice(0, 100),
        original: { file, width, height, bytes: bytes.length },
        cutout: { state: "queued" },
        classification: { state: "pending" },
        labels: null,
        labelsEditedByOwner: false,
        mirrorAllowed: null,
        quality: null,
        starred: false,
        hidden: false,
      };
      await fs.writeFile(fileOf(id), `${JSON.stringify(face, null, 2)}\n`);
      enqueueCut(id);
      return view(face);
    },

    /** Star, hide and the owner's label edits. Editing labels marks them as the owner's, which Reclassify then leaves alone. */
    async patch(id, body) {
      await read(id);
      const patch = {};
      for (const key of ["starred", "hidden"]) {
        if (body[key] === undefined) continue;
        if (typeof body[key] !== "boolean") throw new FaceError("BAD_FLAG", `${key} must be true or false.`);
        patch[key] = body[key];
      }
      if (body.mirrorAllowed !== undefined) {
        if (body.mirrorAllowed !== null && typeof body.mirrorAllowed !== "boolean") throw new FaceError("BAD_FLAG", "mirrorAllowed must be true, false or null.");
        patch.mirrorAllowed = body.mirrorAllowed;
      }
      let edits = null;
      if (body.labels !== undefined) {
        if (!body.labels || typeof body.labels !== "object" || Array.isArray(body.labels)) throw new FaceError("BAD_LABELS", "labels must be an object.");
        edits = {};
        for (const [key, check] of Object.entries(LABEL_FIELDS)) {
          if (body.labels[key] === undefined) continue;
          const value = check(body.labels[key]);
          if (value === null) throw new FaceError("BAD_LABELS", `${key} is not a valid value.`);
          edits[key] = value;
        }
      }
      const next = await mutate(id, (f) => {
        Object.assign(f, patch);
        if (edits && Object.keys(edits).length) {
          const merged = validateLabels({ ...(f.labels ?? {}), ...edits }, { needBox: false });
          if (!merged.ok) throw new FaceError("INCOMPLETE_LABELS", `Give every label (${merged.reason}).`);
          f.labels = merged.labels;
          f.labelsEditedByOwner = true;
          if (f.cutout?.state === "done") f.classification = { state: "done", reason: "", at: new Date().toISOString() };
        }
      });
      return view(next);
    },

    /** Delete is a move to .trash, so Undo is a move back; purged after a week. */
    async trash(id) {
      await read(id);
      await fs.mkdir(trashDir, { recursive: true });
      const queued = cutQueue.indexOf(id);
      if (queued >= 0) cutQueue.splice(queued, 1);
      await fs.rm(path.join(trashDir, id), { recursive: true, force: true });
      await fs.rename(dirOf(id), path.join(trashDir, id));
      await fs.utimes(path.join(trashDir, id), new Date(), new Date()).catch(() => {});
      return { ok: true };
    },

    async restore(id) {
      if (!isFaceId(id)) throw new FaceError("BAD_ID", "Invalid face id.");
      const from = path.join(trashDir, id);
      if (!(await fs.stat(from).then((s) => s.isDirectory(), () => false))) throw new FaceError("NOT_FOUND", "That face is not in the trash.", 404);
      await fs.rename(from, dirOf(id));
      const face = await read(id);
      if (["queued", "running"].includes(face.cutout?.state)) enqueueCut(id);
      return view(face);
    },

    async purgeTrash() {
      const cutoff = Date.now() - TRASH_DAYS * 86_400_000;
      for (const name of await fs.readdir(trashDir).catch(() => [])) {
        const stat = await fs.stat(path.join(trashDir, name)).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) await fs.rm(path.join(trashDir, name), { recursive: true, force: true });
      }
    },

    /**
     * Asks Claude again for these faces (all by default). A face whose labels the owner edited is never
     * touched: it comes back under `skipped`.
     */
    async reclassify(ids) {
      const faces = await readAllFaces(path.dirname(root));
      const wanted = Array.isArray(ids) ? faces.filter((f) => ids.includes(f.id)) : faces;
      const changed = [];
      const skipped = [];
      for (const f of wanted) {
        if (f.labelsEditedByOwner) skipped.push(f.id);
        else if (f.cutout?.state !== "done") skipped.push(f.id);
        else if (classifying.has(f.id)) skipped.push(f.id);
        else {
          await mutate(f.id, (x) => void (x.classification = { state: "pending" })).catch(() => {});
          changed.push(f.id);
        }
      }
      if (changed.length) scheduleClassify();
      return { ok: true, changed, skipped };
    },

    /** Tries a failed cut-out again. */
    async recut(id) {
      const face = await read(id);
      if (face.cutout?.state !== "failed") throw new FaceError("NOT_FAILED", "Only a failed cut-out can be retried.", 409);
      await mutate(id, (f) => {
        f.cutout = { state: "queued" };
        f.classification = { state: "pending" };
      });
      enqueueCut(id);
      return api.get(id);
    },

    /** The file a /faces/<id>/<file> URL may serve, or null: the original, the cut-out and its thumbnail, nothing else. */
    async servable(id, file) {
      if (!isFaceId(id)) return null;
      const face = await read(id).catch(() => null);
      if (!face) return null;
      const allowed = new Set([face.original.file, "cutout.png", "thumb.png"]);
      if (!allowed.has(file)) return null;
      return path.join(dirOf(id), file);
    },

    /** Start-up: cut-outs interrupted by a restart are queued again (local and free); classifications are not rerun. */
    async recover() {
      await fs.rm(path.join(root, ".work"), { recursive: true, force: true }).catch(() => {});
      for (const face of await readAllFaces(path.dirname(root))) {
        if (["queued", "running"].includes(face.cutout?.state)) {
          await mutate(face.id, (f) => void (f.cutout = { state: "queued" })).catch(() => {});
          enqueueCut(face.id);
        } else if (face.cutout?.state === "done" && ["pending", "running"].includes(face.classification?.state)) {
          await mutate(face.id, (f) => {
            f.classification = f.labels ? { state: "done", reason: "" } : { state: "unclassified", reason: "Imago was restarted before this was classified. Press Reclassify." };
          }).catch(() => {});
        }
      }
      await api.purgeTrash().catch(() => {});
    },

    /** Resolves once nothing is queued, being cut out, being classified or waiting to be. For tests and shutdown. */
    async idle() {
      while (cutBusy() || classifying.size || timer) await sleep(25);
    },

    close() {
      closed = true;
      clearTimeout(timer);
      timer = null;
      abort.abort();
    },
  };
  return api;
}
