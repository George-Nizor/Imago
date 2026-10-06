import fs from "node:fs/promises";
import path from "node:path";
import { writeUnique } from "./assets.mjs";
import { MAX_PIXELS, imageInfo, tooManyPixels } from "./image-info.mjs";
import { isSafeLeaf } from "./paths.mjs";

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

/** Removes the background of assets/<asset> locally and writes assets/<stem>-cutout.png. */
export async function cutOut(projectDir, asset) {
  if (!isSafeLeaf(asset)) throw new Error("Invalid asset name.");
  const source = path.join(projectDir, "assets", asset);
  let bytes;
  try {
    bytes = await fs.readFile(source);
  } catch {
    throw new Error(`assets/${asset} does not exist.`);
  }
  const info = imageInfo(bytes);
  if (!info) throw new Error(`assets/${asset} is not a PNG, JPEG or WebP image.`);
  // The decoder inside the library allocates width x height x 4 bytes, so refuse oversized images first.
  if (tooManyPixels(info)) throw new Error(`assets/${asset} is over ${MAX_PIXELS / 1_000_000} megapixels.`);
  // Imported late: it pulls in onnxruntime, which only this call needs.
  const { removeBackground } = await import("@imgly/background-removal-node");
  const blob = await removeBackground(new Blob([bytes], { type: MIME[info.type] }), { output: { format: "image/png" } });
  const png = Buffer.from(await blob.arrayBuffer());
  const out = imageInfo(png);
  if (!out) throw new Error("Background removal produced no image.");
  // Never overwrites: face.jpg and face.png get face-cutout.png and face-cutout-2.png, and a
  // cut-out of face-cutout.png becomes face-cutout-cutout.png.
  const name = await writeUnique(path.join(projectDir, "assets"), `${asset.replace(/\.[^.]+$/, "")}-cutout.png`, png);
  return { name, width: out.width, height: out.height, from: asset };
}
