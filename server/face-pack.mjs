// The face pack, read side: the fixed vocabulary, label validation, the quality grade, ranking, and the
// copy of a cut-out into a project. Shared by the server (faces.mjs, concept sets) and the render MCP,
// which runs in its own process and reads <IMAGO_DATA_DIR>/faces/<id>/ directly. Never writes face.json.
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RETOUCH_STRENGTH } from "./face-retouch.mjs";
import { bakeSticker, limitFaceSize, resolveSticker } from "./face-sticker.mjs";
import { ID_PATTERN } from "./paths.mjs";

export const EXPRESSIONS = ["smile", "laugh", "surprise", "shock", "excited", "thinking", "sceptical", "confused", "intense", "angry", "sad", "neutral"];
export const GESTURES = ["none", "point-left", "point-right", "point-camera", "point-up", "hands-up", "facepalm", "thumbs-up", "thumbs-down", "arms-crossed", "hand-on-chin", "holding-object", "other"];
// In image terms: "left" means the face looks toward the left edge of the picture.
export const GAZES = ["camera", "left", "right", "up", "down"];
export const HEAD_TURNS = ["frontal", "three-quarter", "profile"];
export const GRADES = ["soft", "hd", "4k"];
export const gradeRank = (grade) => GRADES.indexOf(grade);

/**
 * Quality thresholds. A 3x thumbnail export is 2160 px tall and the craft files want the face (hairline to
 * chin) at about half of that, so the face needs roughly 1080 px in the photo to be used 1:1.
 *   4k   face at least 1000 px tall: survives a 3x export filling half the canvas without upscaling
 *   hd   face at least 540 px tall: fine at 1080p; at 3x it is upscaled up to 2x and softens
 *   soft anything smaller
 * Sharpness (variance of the Laplacian of the face crop, scaled to 256 px tall so it does not depend on
 * resolution) can only lower the grade: under 60 a 4k face is held at hd, under 25 anything is soft.
 * Starting values, not calibrated against a large set of photos; tune them here and nowhere else.
 */
export const QUALITY = { px4k: 1000, pxHd: 540, sharp4k: 60, sharpHd: 25, sharpScale: 256 };

export function gradeOf({ faceHeightPx, sharpness }) {
  let grade = faceHeightPx >= QUALITY.px4k ? "4k" : faceHeightPx >= QUALITY.pxHd ? "hd" : "soft";
  if (typeof sharpness === "number") {
    if (sharpness < QUALITY.sharpHd) grade = "soft";
    else if (sharpness < QUALITY.sharp4k && grade === "4k") grade = "hd";
  }
  return grade;
}

const clean = (value, max) => String(value ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** One face box as 0-1 fractions, or null. A little overshoot past the edge is clamped. */
export function validBox(box) {
  if (!box || typeof box !== "object") return null;
  const [x, y, w, h] = ["x", "y", "w", "h"].map((k) => box[k]);
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (x < 0 || y < 0 || x > 1 || y > 1 || w < 0.02 || h < 0.02 || w > 1 || h > 1 || x + w > 1.03 || y + h > 1.03) return null;
  const r = (n) => Math.round(n * 10000) / 10000;
  return { x: r(x), y: r(y), w: r(Math.min(w, 1 - x)), h: r(Math.min(h, 1 - y)) };
}

const oneOf = (list) => (value) => (list.includes(value) ? value : null);

/** The label fields an owner may edit; everything but the face box. Each returns the cleaned value or undefined when invalid. */
export const LABEL_FIELDS = {
  expression: oneOf(EXPRESSIONS),
  intensity: (v) => (Number.isInteger(v) && v >= 1 && v <= 3 ? v : null),
  gesture: oneOf(GESTURES),
  gaze: oneOf(GAZES),
  headTurn: oneOf(HEAD_TURNS),
  eyesOpen: (v) => (typeof v === "boolean" ? v : null),
  textOrLogoInShot: (v) => (typeof v === "boolean" ? v : null),
  description: (v) => (typeof v === "string" && clean(v, 140) ? clean(v, 140) : null),
};

/**
 * The classifier's entry (or an owner's edit merged onto existing labels) against the vocabulary.
 * Returns {ok, labels} with every field present, or {ok: false, reason}. Nothing outside the vocabulary
 * gets through, whatever the photo's text said.
 */
export function validateLabels(raw, { needBox = true } = {}) {
  const bad = (reason) => ({ ok: false, reason });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("not an object");
  const labels = {};
  for (const [key, check] of Object.entries(LABEL_FIELDS)) {
    const value = check(raw[key]);
    if (value === null) return bad(`${key} is missing or outside the vocabulary`);
    labels[key] = value;
  }
  const box = validBox(raw.faceBox);
  if (!box && needBox) return bad("faceBox is missing or not 0-1 fractions");
  if (box) labels.faceBox = box;
  return { ok: true, labels };
}

/** Pixel height of the face box, and the grade; `sharpness` may be null when it could not be measured. */
export function qualityOf({ faceBox, imageHeight, sharpness = null }) {
  if (!faceBox) return null;
  const faceHeightPx = Math.round(faceBox.h * imageHeight);
  return { grade: gradeOf({ faceHeightPx, sharpness }), faceHeightPx, sharpness: typeof sharpness === "number" ? Math.round(sharpness * 10) / 10 : null };
}

/** Variance of the 4-neighbour Laplacian of a grey 8-bit buffer; higher is sharper. */
export function laplacianVariance(grey, width, height) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const v = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width];
      sum += v;
      sumSq += v * v;
      n += 1;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Sharpness of the face crop of an image (bytes), at a fixed crop height; null when sharp cannot read it. */
export async function measureSharpness(bytes, faceBox) {
  try {
    const sharp = (await import("sharp")).default;
    const upright = sharp(bytes, { limitInputPixels: 100_000_000 }).rotate();
    const { width, height } = await upright.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
    const left = Math.max(0, Math.floor(faceBox.x * width));
    const top = Math.max(0, Math.floor(faceBox.y * height));
    const w = Math.max(8, Math.min(width - left, Math.round(faceBox.w * width)));
    const h = Math.max(8, Math.min(height - top, Math.round(faceBox.h * height)));
    const { data, info } = await sharp(await upright.toBuffer(), { limitInputPixels: 100_000_000 })
      .extract({ left, top, width: w, height: h })
      .resize({ height: QUALITY.sharpScale, fit: "inside" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return laplacianVariance(data, info.width, info.height);
  } catch {
    return null;
  }
}

// ---- reading the pack ------------------------------------------------------------------------------

export const facesRoot = (dataDir) => path.join(dataDir, "faces");
export const isFaceId = (value) => typeof value === "string" && /^[a-f0-9]{8}$/.test(value) && ID_PATTERN.test(value);

export async function readFace(dataDir, id) {
  if (!isFaceId(id)) return null;
  try {
    const face = JSON.parse(await fs.readFile(path.join(facesRoot(dataDir), id, "face.json"), "utf8"));
    return face && face.id === id ? face : null;
  } catch {
    return null;
  }
}

export async function readAllFaces(dataDir) {
  const names = await fs.readdir(facesRoot(dataDir)).catch(() => []);
  const faces = await Promise.all(names.filter(isFaceId).map((id) => readFace(dataDir, id)));
  return faces.filter(Boolean);
}

const strengthOf = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 100) / 100)) : null);

/**
 * Pack-wide settings (<faces>/settings.json): `mirrorAll` (default true) lets every face be mirrored unless the
 * owner says otherwise; `retouchAll` (default true) retouches every face unless the owner says otherwise, at
 * `retouchStrength` (0 to 1).
 */
export async function readSettings(dataDir) {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(facesRoot(dataDir), "settings.json"), "utf8"));
    return { mirrorAll: raw?.mirrorAll !== false, retouchAll: raw?.retouchAll !== false, retouchStrength: strengthOf(raw?.retouchStrength) ?? DEFAULT_RETOUCH_STRENGTH };
  } catch {
    return { mirrorAll: true, retouchAll: true, retouchStrength: DEFAULT_RETOUCH_STRENGTH };
  }
}

export const cleanStrength = strengthOf;
/** A strength from the API: exactly 0 to 1, else null (cleanStrength would clamp it). */
export const validStrength = (v) => (typeof v === "number" && v >= 0 && v <= 1 ? strengthOf(v) : null);

/** Is this face retouched? The owner's per-face choice (`retouch` true or false) wins; null follows the pack's `retouchAll`. */
export function retouchOn(face, settings = { retouchAll: true }) {
  if (face.retouch === true || face.retouch === false) return face.retouch;
  return settings.retouchAll !== false;
}

/** The strength a face is retouched at: its own, else the pack's. */
export const retouchStrengthFor = (face, settings = {}) => strengthOf(face.retouchStrength) ?? strengthOf(settings.retouchStrength) ?? DEFAULT_RETOUCH_STRENGTH;

/** The image file a design gets for this face: retouched.png when retouching is on and done, else the plain cut-out. */
export const faceImageFile = (face, settings) => (retouchOn(face, settings) && face.retouched?.state === "done" ? "retouched.png" : "cutout.png");

/**
 * May this face be mirrored? The owner's per-face choice (`mirrorAllowed` true or false) wins. With none
 * (null), the pack default decides: allowed when `mirrorAll` is on, otherwise only when Claude saw no
 * text or logo in the shot.
 */
export function mirrorAllowedFor(face, settings = { mirrorAll: true }) {
  if (face.mirrorAllowed === true || face.mirrorAllowed === false) return face.mirrorAllowed;
  return settings.mirrorAll ? true : face.labels?.textOrLogoInShot === false;
}

/** Can a design use this face? Cut out, classified and not hidden by the owner. */
export const usable = (face) => face.cutout?.state === "done" && face.classification?.state === "done" && Boolean(face.labels) && face.hidden !== true;

/** The facts a designer or planner needs about one face. */
export function summarize(face, settings = { mirrorAll: true }) {
  const l = face.labels ?? {};
  return {
    id: face.id,
    expression: l.expression ?? null,
    intensity: l.intensity ?? null,
    gesture: l.gesture ?? null,
    gaze: l.gaze ?? null,
    headTurn: l.headTurn ?? null,
    eyesOpen: l.eyesOpen ?? null,
    textOrLogoInShot: l.textOrLogoInShot ?? null,
    mirrorSafe: mirrorAllowedFor(face, settings),
    retouched: faceImageFile(face, settings) === "retouched.png",
    grade: face.quality?.grade ?? null,
    faceHeightPx: face.quality?.faceHeightPx ?? null,
    width: face.cutout?.width ?? null,
    height: face.cutout?.height ?? null,
    starred: face.starred === true,
    description: l.description ?? "",
  };
}

/**
 * Best matches first: starred, then the higher grade, then a blend of sharpness (capped at 200) and
 * recency (position among the candidates). Hidden and unclassified faces never appear.
 */
export function orderFaces(faces, { expression, gesture, gaze, minGrade } = {}) {
  const pool = faces.filter(usable).filter((f) => {
    const l = f.labels;
    return (!expression || l.expression === expression) && (!gesture || l.gesture === gesture) && (!gaze || l.gaze === gaze) && (!minGrade || gradeRank(f.quality?.grade ?? "soft") >= gradeRank(minGrade));
  });
  const byAge = [...pool].sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
  const recency = new Map(byAge.map((f, i) => [f.id, byAge.length > 1 ? i / (byAge.length - 1) : 1]));
  const score = (f) => 0.6 * Math.min(1, (f.quality?.sharpness ?? 0) / 200) + 0.4 * (recency.get(f.id) ?? 0);
  return pool.sort((a, b) => Number(b.starred === true) - Number(a.starred === true) || gradeRank(b.quality?.grade ?? "soft") - gradeRank(a.quality?.grade ?? "soft") || score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
}

/** The best `count` (1 to 12) matches. */
export const rankFaces = (faces, query = {}) => orderFaces(faces, query).slice(0, Math.max(1, Math.min(12, Math.floor(query.count ?? 4))));

/** How many usable faces carry each expression, for "what is in the pack". */
export function availability(faces) {
  const out = {};
  for (const f of faces.filter(usable)) out[f.labels.expression] = (out[f.labels.expression] ?? 0) + 1;
  return out;
}

/**
 * The faces shown to the planner: starred first, then the best face of each expression, then whatever is
 * best of the rest, capped so the sheet stays legible.
 */
export function packSelection(faces, cap = 24) {
  const order = orderFaces(faces);
  const chosen = [];
  const take = (f) => {
    if (f && !chosen.includes(f) && chosen.length < cap) chosen.push(f);
  };
  for (const f of order.filter((x) => x.starred)) take(f);
  for (const expression of EXPRESSIONS) take(order.find((f) => f.labels.expression === expression));
  for (const f of order) take(f);
  return chosen;
}

// ---- using a face in a project ----------------------------------------------------------------------

export const faceAssetName = (id, mirrored = false, sticker = false) => `face-${id}${mirrored ? "-mirrored" : ""}${sticker ? "-sticker" : ""}.png`;
export const FACE_ASSET = /^face-([a-f0-9]{8})(-mirrored)?(-sticker)?\.png$/;

/** The pack file a face's copy comes from, and when it last changed: how a project knows its copy is out of date. */
export async function packSource(dataDir, face, settings) {
  const file = faceImageFile(face, settings);
  const stat = await fs.stat(path.join(facesRoot(dataDir), face.id, file));
  return { file, mtimeMs: Math.round(stat.mtimeMs) };
}

/**
 * Copies a face's cut-out (its retouched version when retouching is on) into `<projectDir>/assets/` as face-<id>.png, or as face-<id>-mirrored.png with
 * the pixels really flipped. A face wider or taller than 2400 px is scaled down to that (the pack keeps the full size). With `sticker`
 * (true, or {cream?, ink?, displayWidth?}) the outline is baked into the PNG as face-<id>[-mirrored]-sticker.png, see face-sticker.mjs.
 * Returns {name, id, mirrored, width, height, grade, faceHeightPx, retouched, stamp, sticker?, display?}. Refuses a mirror when the
 * shot has text or a logo in it, and any face the owner hid or that is not ready.
 */
export async function takeFace(dataDir, projectDir, id, { mirror = false, sticker = false } = {}) {
  const face = await readFace(dataDir, id);
  if (!face) throw new Error(`There is no face ${JSON.stringify(String(id).slice(0, 20))} in the pack.`);
  if (face.hidden) throw new Error("The owner hid this face; choose another.");
  if (!usable(face)) throw new Error("This face is not ready yet (still being cut out or classified).");
  const settings = await readSettings(dataDir);
  if (mirror && !mirrorAllowedFor(face, settings)) throw new Error("Mirroring is not allowed for this face (the shot has text or a logo in it, or the owner switched it off); use it as it is or pick another face.");
  const resolved = await resolveSticker(sticker, projectDir);
  const name = faceAssetName(id, mirror, Boolean(resolved));
  const dest = path.join(projectDir, "assets", name);
  const stamp = await packSource(dataDir, face, settings);
  const source = path.join(facesRoot(dataDir), id, stamp.file);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const bytes = await fs.readFile(source);
  let out;
  let display;
  if (resolved) {
    // Mirror first, then bake: the outline is drawn on the face as it will be placed.
    const base = mirror ? (await limitFaceSize(bytes, { flop: true }))?.data ?? bytes : bytes;
    const baked = await bakeSticker(base, resolved);
    out = { data: baked.data, width: baked.width, height: baked.height };
    display = baked.display;
  } else {
    out = await limitFaceSize(bytes, { flop: mirror });
  }
  if (out) await fs.writeFile(dest, out.data);
  else await fs.copyFile(source, dest);
  return {
    name,
    id,
    mirrored: mirror,
    width: out?.width ?? face.cutout.width,
    height: out?.height ?? face.cutout.height,
    grade: face.quality?.grade ?? null,
    faceHeightPx: face.quality?.faceHeightPx ?? null,
    retouched: stamp.file === "retouched.png",
    stamp,
    ...(resolved ? { sticker: resolved, display } : {}),
  };
}

/** Is the project's copy of each of its pack faces older than the pack's? `assets` are the project's records. */
export async function faceStatus(dataDir, projectDir, assets) {
  const faces = new Map();
  for (const a of assets.filter((x) => x.kind === "face" && x.faceId)) faces.set(a.faceId, [...(faces.get(a.faceId) ?? []), a]);
  const settings = await readSettings(dataDir);
  const out = [];
  for (const [id, list] of faces) {
    const face = await readFace(dataDir, id);
    if (!face || face.hidden || !usable(face)) {
      out.push({ id, state: "unavailable", assets: list.map((a) => a.name), reason: !face ? "The face is no longer in the pack." : face.hidden ? "The owner hid this face." : "The face is not ready." });
      continue;
    }
    const now = await packSource(dataDir, face, settings).catch(() => null);
    let stale = false;
    for (const a of list) {
      const had = a.stamp ?? { file: null, mtimeMs: (await fs.stat(path.join(projectDir, "assets", a.name)).catch(() => null))?.mtimeMs ?? Infinity };
      if (now && ((had.file && had.file !== now.file) || now.mtimeMs > had.mtimeMs + 1)) stale = true;
    }
    out.push({ id, state: stale ? "stale" : "current", assets: list.map((a) => a.name) });
  }
  return out;
}

/**
 * Faces for a "try other faces" set when the owner gave only a count: the best faces with distinct expressions, none already in
 * the design (`exclude`), preferring expressions other than the design's own (`avoidExpression`), then the next best faces.
 */
export function pickVariantFaces(faces, { count, exclude = [], avoidExpression = null }) {
  const pool = orderFaces(faces).filter((f) => !exclude.includes(f.id));
  const chosen = [];
  const seen = new Set();
  const take = (f) => {
    chosen.push(f);
    seen.add(f.id);
  };
  const expressions = new Set();
  for (const f of pool) {
    if (chosen.length >= count) break;
    if (f.labels.expression !== avoidExpression && !expressions.has(f.labels.expression)) {
      expressions.add(f.labels.expression);
      take(f);
    }
  }
  for (const f of pool) {
    if (chosen.length >= count) break;
    if (!seen.has(f.id) && !expressions.has(f.labels.expression)) {
      expressions.add(f.labels.expression);
      take(f);
    }
  }
  for (const f of pool) {
    if (chosen.length >= count) break;
    if (!seen.has(f.id)) take(f);
  }
  return chosen;
}
