// Exports that are more than one file or have a size budget: YouTube's Test & Compare (3840x2160
// JPG, each under 2 MB) and the vertical covers per platform. JPEG quality steps down inside the
// renderer until the file fits.
import fs from "node:fs/promises";
import path from "node:path";
import { validateDesignFile } from "./design-files.mjs";
import { isSafeLeaf } from "./paths.mjs";
import { allowedScales } from "./presets/index.mjs";
import { RenderError, renderExport } from "./renderer.mjs";
import { createZipWriter } from "./zip.mjs";

/** Just under 2 MB whichever way it is counted (2 MB = 2,097,152 bytes or 2,000,000). */
export const JPEG_BUDGET = 1_990_000;

export class ExportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Pixel sizes of the vertical covers. YouTube's is its documented Shorts size; Reels and TikTok take 1080x1920. */
export const PLATFORM_EXPORTS = {
  "youtube-shorts": { label: "YouTube Shorts", width: 2160, height: 3840 },
  "instagram-reels": { label: "Instagram Reels", width: 1080, height: 1920 },
  tiktok: { label: "TikTok", width: 1080, height: 1920 },
};

export const asciiSlug = (text, fallback = "design") =>
  String(text ?? "").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || fallback;

/**
 * Renders a project's design.html to a JPG `width` px wide (the canvas' aspect), under `maxBytes`.
 * Returns {width, height, bytes, quality, overBudget}.
 */
export async function renderJpg(config, store, id, { width, out, maxBytes = JPEG_BUDGET }) {
  const project = await store.read(id);
  const dir = store.dirOf(id);
  const { errors } = await validateDesignFile(dir, project.size, config.fontsDir);
  if (errors.length) throw new ExportError("INVALID_DESIGN", `${project.title}: ${errors.join(" ")}`, 422);
  const scale = width / project.size.width;
  try {
    const done = await renderExport(config, { htmlFile: path.join(dir, "design.html"), ...project.size, scale, format: "jpg", out, maxBytes }, path.join(dir, "renders", `v${project.current}.png`));
    return { width: done.width, height: done.height, bytes: done.bytes, quality: done.quality ?? 92, overBudget: done.bytes > maxBytes };
  } catch (error) {
    if (error instanceof RenderError) throw new ExportError("RENDER_FAILED", error.message, 503);
    throw error;
  }
}

/** Writes a store-only zip of {name, file} entries to `out`. */
export async function writeZip(out, entries) {
  const chunks = [];
  const zip = createZipWriter((chunk) => void chunks.push(Buffer.from(chunk)));
  for (const { name, file } of entries) await zip.add(name, await fs.readFile(file));
  await zip.finish();
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, Buffer.concat(chunks));
  return (await fs.stat(out)).size;
}

// ---- the project's own exports folder: one-click export, the list, and removal ----------------------

const EXPORT_FILES = new Set([".jpg", ".jpeg", ".png", ".webp", ".zip"]);

/** The finished files in a project's exports/, newest first: {name, url, bytes, at, kind: image|zip}. */
export async function listExports(dir, id) {
  const out = [];
  for (const name of await fs.readdir(path.join(dir, "exports")).catch(() => [])) {
    const ext = path.extname(name).toLowerCase();
    if (!EXPORT_FILES.has(ext) || !isSafeLeaf(name)) continue;
    const stat = await fs.stat(path.join(dir, "exports", name)).catch(() => null);
    if (!stat?.isFile()) continue;
    out.push({ name, url: `/projects/${id}/exports/${name}`, bytes: stat.size, at: new Date(stat.mtimeMs).toISOString(), kind: ext === ".zip" ? "zip" : "image" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.name.localeCompare(b.name));
}

/** Removes one file from a project's exports/; false when it was not there. */
export async function deleteExport(dir, name) {
  if (!isSafeLeaf(name) || !EXPORT_FILES.has(path.extname(name).toLowerCase())) throw new ExportError("BAD_NAME", "That is not an export file name.");
  try {
    await fs.rm(path.join(dir, "exports", name));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * One click: the current design as a JPG at the largest size up to 3x (a thumbnail: 3840 px wide, under 2 MB, YouTube's own
 * limit), saved in the project's exports/ under a name made from its title, so exporting twice overwrites rather than piles up.
 * Returns {name, url, width, height, bytes, overBudget}.
 */
export async function quickExport(config, store, id) {
  const project = await store.read(id);
  if (!project.current) throw new ExportError("NO_RENDERS", "There is no render to export yet.", 409);
  const dir = store.dirOf(id);
  const name = `${asciiSlug(project.title, "design")}-v${project.current}.jpg`;
  const out = path.join(dir, "exports", name);
  const scale = Math.max(...allowedScales(project.size).filter((s) => s <= 3));
  if (project.preset === "thumbnail") {
    const done = await renderJpg(config, store, id, { width: project.size.width * scale, out });
    return { name, url: `/projects/${id}/exports/${name}`, width: done.width, height: done.height, bytes: done.bytes, overBudget: done.overBudget };
  }
  const { errors } = await validateDesignFile(dir, project.size, config.fontsDir);
  if (errors.length) throw new ExportError("INVALID_DESIGN", `${project.title}: ${errors.join(" ")}`, 422);
  try {
    const done = await renderExport(config, { htmlFile: path.join(dir, "design.html"), ...project.size, scale, format: "jpg", out }, path.join(dir, "renders", `v${project.current}.png`));
    return { name, url: `/projects/${id}/exports/${name}`, width: done.width, height: done.height, bytes: done.bytes, overBudget: false };
  } catch (error) {
    if (error instanceof RenderError) throw new ExportError("RENDER_FAILED", error.message, 503);
    throw error;
  }
}
