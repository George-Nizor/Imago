// Baked sticker outlines for pack faces, and the size cap for every face a project receives.
// A cut-out under 9 to 14 stacked drop-shadow() filters made a 3x render take 20 to 40 s, because Chromium
// rasters each filter over the whole 3000 px image. The outline is drawn once into the PNG instead: the
// subject's alpha is grown by a true circle (an exact distance transform, not a blur and a threshold, so the
// radius is the one asked for), ink first, then cream, then the subject on top.
import fs from "node:fs/promises";
import path from "node:path";

/** The longest side of any face image handed to a project. A 3392 px cut-out was up to 12 MB and slowed every render. */
export const MAX_FACE_SIDE = 2400;
export const STICKER_DEFAULTS = { cream: "#F6EFDC", ink: "#15130F", displayWidth: 800, creamPx: 8, inkPx: 13 };
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export class StickerError extends Error {}

const rgbOf = (hex) => {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const finite = (v, min, max, what) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new StickerError(`sticker ${what} must be a number from ${min} to ${max}.`);
  return v;
};

/** The brand snapshot's light and ink colours, when the project has a brand (null otherwise). */
export async function brandOutlineColours(projectDir) {
  try {
    const snapshot = JSON.parse(await fs.readFile(path.join(projectDir, "reference", "brand.json"), "utf8"));
    const pick = (role) => snapshot.colours?.find((c) => c?.role === role && typeof c.hex === "string" && HEX.test(c.hex))?.hex ?? null;
    return { cream: pick("light"), ink: pick("ink") };
  } catch {
    return { cream: null, ink: null };
  }
}

/** A sticker request (true or {cream?, ink?, displayWidth?, creamPx?, inkPx?}) resolved against the brand and the defaults. */
export async function resolveSticker(request, projectDir) {
  if (!request) return null;
  const given = request === true ? {} : request;
  if (typeof given !== "object" || Array.isArray(given)) throw new StickerError("sticker must be true or {cream?, ink?, displayWidth?}.");
  const brand = await brandOutlineColours(projectDir);
  const colour = (value, fromBrand, fallback, what) => {
    if (value === undefined || value === null) return (fromBrand ?? fallback).toUpperCase();
    if (typeof value !== "string" || !HEX.test(value.trim())) throw new StickerError(`sticker ${what} must be a hex colour such as #F6EFDC.`);
    return value.trim().toUpperCase();
  };
  const resolved = {
    cream: colour(given.cream, brand.cream, STICKER_DEFAULTS.cream, "cream"),
    ink: colour(given.ink, brand.ink, STICKER_DEFAULTS.ink, "ink"),
    displayWidth: given.displayWidth === undefined ? STICKER_DEFAULTS.displayWidth : finite(given.displayWidth, 50, 4000, "displayWidth"),
    creamPx: given.creamPx === undefined ? STICKER_DEFAULTS.creamPx : finite(given.creamPx, 1, 60, "creamPx"),
    inkPx: given.inkPx === undefined ? STICKER_DEFAULTS.inkPx : finite(given.inkPx, 1, 100, "inkPx"),
  };
  if (resolved.inkPx <= resolved.creamPx) resolved.inkPx = resolved.creamPx + 1;
  return resolved;
}

/** Squared Euclidean distance to the nearest `inside` pixel (Felzenszwalb and Huttenlocher), in place on `d`. */
function distanceSquared(inside, width, height) {
  const INF = 1e12;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i += 1) d[i] = inside[i] ? 0 : INF;
  const n = Math.max(width, height);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const f = new Float64Array(n);
  const pass = (length, read, write) => {
    for (let i = 0; i < length; i += 1) f[i] = read(i);
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    const cross = (q, p) => (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    for (let q = 1; q < length; q += 1) {
      let s = cross(q, v[k]);
      while (s <= z[k]) {
        k -= 1;
        s = cross(q, v[k]);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q += 1) {
      while (z[k + 1] < q) k += 1;
      const p = v[k];
      write(q, (q - p) * (q - p) + f[p]);
    }
  };
  for (let x = 0; x < width; x += 1) pass(height, (y) => d[y * width + x], (y, value) => void (d[y * width + x] = value));
  for (let y = 0; y < height; y += 1) pass(width, (x) => d[y * width + x], (x, value) => void (d[y * width + x] = value));
  return d;
}

const coverage = (radius, distance) => (distance <= radius - 0.5 ? 1 : distance >= radius + 0.5 ? 0 : radius + 0.5 - distance);

/**
 * Bakes the outline into a cut-out. `bytes` is the cut-out PNG; `sticker` is a resolved sticker (see resolveSticker).
 * Returns {data (PNG), width, height, display}: `display` is what to give the new image in CSS px so the face keeps
 * the size and place the plain cut-out had at `displayWidth` (width and height of the image element, and the offset
 * to subtract from its left and top, because the outline adds a margin all round).
 */
export async function bakeSticker(bytes, sticker) {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
  const srcW = meta.width;
  const srcH = meta.height;
  // Source pixels per CSS pixel at the size the design shows the face, then scaled so the padded result fits the cap.
  const outlineSrc = (sticker.inkPx * srcW) / sticker.displayWidth;
  const k = Math.min(1, (MAX_FACE_SIDE - 16) / (srcW + 2 * outlineSrc), (MAX_FACE_SIDE - 16) / (srcH + 2 * outlineSrc));
  const faceW = Math.max(1, Math.round(srcW * k));
  const faceH = Math.max(1, Math.round(srcH * k));
  const pxPerCss = faceW / sticker.displayWidth;
  const pad = Math.ceil(sticker.inkPx * pxPerCss) + 4;
  const { data: rgba, info } = await sharp(bytes, { limitInputPixels: 100_000_000 })
    .rotate()
    .ensureAlpha()
    .resize(faceW, faceH, { fit: "fill" })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const count = width * height;
  const inside = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) inside[i] = rgba[i * 4 + 3] >= 8 ? 1 : 0;
  const dist = distanceSquared(inside, width, height);
  const creamR = sticker.creamPx * pxPerCss;
  const inkR = sticker.inkPx * pxPerCss;
  const cream = rgbOf(sticker.cream);
  const ink = rgbOf(sticker.ink);
  const out = Buffer.allocUnsafe(count * 4);
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const sa = rgba[o + 3] / 255;
    const dd = dist[i];
    // Anything further than the ink's reach, with no subject there, stays transparent.
    const ca = dd > (inkR + 1) * (inkR + 1) ? 0 : coverage(creamR, Math.sqrt(dd));
    const ia = dd > (inkR + 1) * (inkR + 1) ? 0 : coverage(inkR, Math.sqrt(dd));
    // cream over ink
    const a1 = ca + ia * (1 - ca);
    // subject over that
    const a2 = sa + a1 * (1 - sa);
    if (a2 <= 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c += 1) {
      const under = a1 > 0 ? (cream[c] * ca + ink[c] * ia * (1 - ca)) / a1 : 0;
      out[o + c] = Math.round((rgba[o + c] * sa + under * a1 * (1 - sa)) / a2);
    }
    out[o + 3] = Math.round(a2 * 255);
  }
  const data = await sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer();
  const cssPerPx = sticker.displayWidth / faceW;
  return { data, width, height, display: { width: round2(width * cssPerPx), height: round2(height * cssPerPx), offset: round2(pad * cssPerPx) } };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** The bytes scaled down so neither side passes MAX_FACE_SIDE (PNG), or null when they already fit. */
export async function limitFaceSize(bytes, { flop = false } = {}) {
  const sharp = (await import("sharp")).default;
  const { width, height } = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
  const big = Math.max(width, height) > MAX_FACE_SIDE;
  if (!big && !flop) return null;
  let image = sharp(bytes, { limitInputPixels: 100_000_000 });
  if (flop) image = image.flop();
  if (big) image = image.resize({ width: MAX_FACE_SIDE, height: MAX_FACE_SIDE, fit: "inside" });
  const { data, info } = await image.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
