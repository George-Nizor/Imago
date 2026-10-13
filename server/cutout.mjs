import fs from "node:fs/promises";
import path from "node:path";
import { writeUnique } from "./assets.mjs";
import { MAX_PIXELS, imageInfo, tooManyPixels } from "./image-info.mjs";
import { isSafeLeaf } from "./paths.mjs";

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

/** The local background removal on PNG, JPEG or WebP bytes. Returns {png, width, height}. */
export async function cutOutBytes(bytes) {
  const info = imageInfo(bytes);
  if (!info) throw new Error("Not a PNG, JPEG or WebP image.");
  // The decoder inside the library allocates width x height x 4 bytes, so refuse oversized images first.
  if (tooManyPixels(info)) throw new Error(`Over ${MAX_PIXELS / 1_000_000} megapixels.`);
  const sharp = (await import("sharp")).default;
  // Upright first, losslessly, so the mask and the pixels it is applied to are the same image.
  const upright = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).rotate().png({ compressionLevel: 1 }).toBuffer();
  // Imported late: it pulls in onnxruntime, which only this call needs.
  const { removeBackground } = await import("@imgly/background-removal-node");
  const blob = await removeBackground(new Blob([upright], { type: MIME.png }), { output: { format: "image/png" } });
  const removed = Buffer.from(await blob.arrayBuffer());
  if (!imageInfo(removed)) throw new Error("Background removal produced no image.");
  // The library's PNG is a 256-colour palette image: skin and teeth come back dithered into speckles, which any
  // retouching then makes worse. Only its transparency is used; the colour is the photo's own, at full depth.
  const mask = await sharp(removed).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const base = await sharp(upright).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (base.info.width !== mask.info.width || base.info.height !== mask.info.height) {
    const png = await sharp(removed).ensureAlpha().png().toBuffer();
    return { png, width: mask.info.width, height: mask.info.height };
  }
  const { width, height } = base.info;
  const png = await sharp(base.data, { raw: { width, height, channels: 3 } })
    .joinChannel(solidInterior(mask.data, width, height), { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return { png, width, height };
}

/** Cuts out the image at `source` and writes the PNG to `destination` (the face pack's one call). */
export async function cutOutFile(source, destination) {
  const { png, width, height } = await cutOutBytes(await fs.readFile(source));
  await fs.writeFile(destination, png);
  return { width, height };
}

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
  if (tooManyPixels(info)) throw new Error(`assets/${asset} is over ${MAX_PIXELS / 1_000_000} megapixels.`);
  const { png, width, height } = await cutOutBytes(bytes);
  // Never overwrites: face.jpg and face.png get face-cutout.png and face-cutout-2.png, and a
  // cut-out of face-cutout.png becomes face-cutout-cutout.png.
  const name = await writeUnique(path.join(projectDir, "assets"), `${asset.replace(/\.[^.]+$/, "")}-cutout.png`, png);
  return { name, width, height, from: asset };
}

/**
 * The model sometimes leaves bright areas inside the subject (teeth, eye whites) a few levels short of opaque. Pixels that
 * are already nearly opaque (200 or more) and more than a few pixels from anything clearly transparent are made fully
 * opaque. Clearly transparent areas stay transparent wherever they are, including background enclosed by the subject (the
 * gap between a raised arm and the head), and the soft edge is left exactly as the model gave it.
 */
export function solidInterior(alpha, width, height, margin = 6) {
  const n = width * height;
  const far = 1e6;
  // Chamfer distance from the nearest clearly transparent pixel, two passes.
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i += 1) dist[i] = alpha[i] < 128 ? 0 : far;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - width] + 1);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (x < width - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < height - 1) dist[i] = Math.min(dist[i], dist[i + width] + 1);
    }
  }
  const out = Buffer.from(alpha);
  for (let i = 0; i < n; i += 1) if (alpha[i] >= 200 && dist[i] > margin) out[i] = 255;
  return out;
}
