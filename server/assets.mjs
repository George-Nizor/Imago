import fs from "node:fs/promises";
import path from "node:path";
import { EXTENSION, MAX_PIXELS, imageInfo, tooManyPixels } from "./image-info.mjs";
import { isSafeLeaf, sanitizeLeaf } from "./paths.mjs";
import { photoSize } from "./presets/index.mjs";
import { httpUrlOnly } from "./stock.mjs";

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export class UploadError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Writes `bytes` under the first free name (wanted, wanted-2, ...); "wx" makes the claim atomic. */
export async function writeUnique(dir, wanted, bytes) {
  const ext = path.extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? wanted : `${stem}-${n}${ext}`;
    try {
      await fs.writeFile(path.join(dir, name), bytes, { flag: "wx" });
      return name;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

/** Image file types served and registered from a project folder. */
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
export const isImageName = (name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());

/** Stores an uploaded image under assets/ (safe leaf name, extension from the real type). */
export async function saveUpload(store, id, filename, bytes) {
  const info = imageInfo(bytes);
  if (!info) throw new UploadError("UNSUPPORTED_IMAGE", "Only PNG, JPEG or WebP images can be uploaded.", 415);
  if (tooManyPixels(info)) throw new UploadError("IMAGE_TOO_LARGE", `Images over ${MAX_PIXELS / 1_000_000} megapixels cannot be used (this one is ${info.width}×${info.height}).`, 413);
  const dir = path.join(store.dirOf(id), "assets");
  const stem = sanitizeLeaf(filename, "image").replace(/\.[^.]*$/, "") || "image";
  const wanted = `${stem.slice(0, 80)}.${EXTENSION[info.type]}`;
  const name = await writeUnique(dir, isSafeLeaf(wanted) ? wanted : `image.${EXTENSION[info.type]}`, bytes);
  // "First upload" is decided inside the project's write queue, so concurrent uploads cannot both be first.
  await store.mutate(id, (project) => {
    const first = !project.assets.some((a) => a.kind === "upload");
    project.assets.push({ name, kind: "upload", width: info.width, height: info.height, from: null });
    // A photo project takes its canvas from the first photo unless the size was chosen up front.
    if (project.preset === "photo" && project.sizeAuto && first) {
      project.size = photoSize(info, project.brief?.aspect ?? "original");
    }
  });
  return { name, width: info.width, height: info.height };
}

const CREDIT_FIELDS = ["credit", "license", "licenseUrl", "source"];

/** A stock image's sidecar (assets/<name>.json, written by fetch_image), or null. */
async function readSidecar(dir, name) {
  try {
    const side = JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), "utf8"));
    if (!side || typeof side !== "object" || !side.fetchedAt) return null;
    return { ...side, licenseUrl: httpUrlOnly(side.licenseUrl) };
  } catch {
    return null;
  }
}

/** A cut-out of a credited image carries that credit on. */
function inheritCredit(entry, pool) {
  const parent = entry.from ? pool.find((a) => a.name === entry.from) : null;
  if (parent?.credit !== undefined) for (const key of CREDIT_FIELDS) if (parent[key] !== undefined) entry[key] = parent[key];
  return entry;
}

/** Adds files that appeared in assets/ (Claude's cut_out and fetch_image) to project.json. */
export async function syncAssets(store, id) {
  const dir = path.join(store.dirOf(id), "assets");
  const files = await fs.readdir(dir).catch(() => []);
  const existing = (await store.read(id)).assets;
  const known = new Set(existing.map((a) => a.name));
  const fresh = [];
  for (const name of files) {
    if (known.has(name) || !isSafeLeaf(name) || !isImageName(name)) continue;
    const info = imageInfo(await fs.readFile(path.join(dir, name)).catch(() => Buffer.alloc(0)));
    if (!info || tooManyPixels(info)) continue;
    const side = await readSidecar(dir, name);
    if (side) {
      fresh.push({
        name,
        kind: "stock",
        width: info.width,
        height: info.height,
        from: null,
        credit: String(side.credit ?? ""),
        license: String(side.license ?? ""),
        licenseUrl: String(side.licenseUrl ?? ""),
        source: String(side.source ?? ""),
        url: String(side.url ?? ""),
      });
      continue;
    }
    const cut = /^(.+)-cutout(?:-\d+)?\.png$/.exec(name);
    const from = cut ? files.find((f) => f !== name && f.replace(/\.[^.]+$/, "") === cut[1]) ?? null : null;
    fresh.push({ name, kind: cut ? "cutout" : "upload", width: info.width, height: info.height, from });
  }
  for (const entry of fresh) inheritCredit(entry, [...existing, ...fresh]);
  if (fresh.length) await store.mutate(id, (project) => void project.assets.push(...fresh));
  return fresh;
}

/** The stock images (and their cut-outs) a design actually uses, as the credits to show. */
export function creditsFor(project, designHtml) {
  return project.assets
    .filter((a) => a.credit !== undefined && designHtml.includes(`assets/${a.name}`))
    .map((a) => ({ name: a.name, credit: a.credit, license: a.license ?? "", licenseUrl: a.licenseUrl ?? "", source: a.source ?? "" }));
}

export async function registerCutout(store, id, { name, width, height, from }) {
  await store.mutate(id, (project) => {
    project.assets = project.assets.filter((a) => a.name !== name);
    project.assets.push(inheritCredit({ name, kind: "cutout", width, height, from }, project.assets));
  });
}
