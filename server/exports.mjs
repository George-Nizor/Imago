// Exports that are more than one file or have a size budget: YouTube's Test & Compare (3840x2160
// JPG, each under 2 MB) and the vertical covers per platform. JPEG quality steps down inside the
// renderer until the file fits.
import fs from "node:fs/promises";
import path from "node:path";
import { validateDesignFile } from "./design-files.mjs";
import { RenderError, renderHtml } from "./renderer.mjs";
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
    const done = await renderHtml(config, { htmlFile: path.join(dir, "design.html"), ...project.size, scale, format: "jpg", out, maxBytes });
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
