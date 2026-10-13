"use strict";

// Measurements over a captured render. Everything here is pure (a BGRA bitmap in, numbers out) so
// the unit tests can feed it synthetic images; render.cjs supplies the real ones.

const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an sRGB colour (0-255 channels). */
function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(a, b) {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB (0-255) to CIE Lab, D65. */
function rgbToLab(r, g, b) {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** RGB at pixel index `i` of a BGRA bitmap, composited over white so transparent areas read as paper. */
function rgbAt(bitmap, i) {
  const a = bitmap[i * 4 + 3] / 255;
  const mix = (c) => Math.round(c * a + 255 * (1 - a));
  return [mix(bitmap[i * 4 + 2]), mix(bitmap[i * 4 + 1]), mix(bitmap[i * 4])];
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] ?? 0;

/**
 * Whole-image statistics of a BGRA bitmap (use a downscaled one: feed size, not full size).
 * `spread` is the p95 minus p5 of Rec.709 luma (0-1); `colourfulness` is Hasler and Susstrunk's M.
 */
function pixelStats(bitmap, width, height) {
  const n = width * height;
  const lumas = new Float32Array(n);
  let sumRg = 0, sumYb = 0, sumRg2 = 0, sumYb2 = 0, sumL = 0, sumA = 0, sumB = 0;
  for (let i = 0; i < n; i += 1) {
    const [r, g, b] = rgbAt(bitmap, i);
    lumas[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    sumRg += rg;
    sumYb += yb;
    sumRg2 += rg * rg;
    sumYb2 += yb * yb;
    const lab = rgbToLab(r, g, b);
    sumL += lab[0];
    sumA += lab[1];
    sumB += lab[2];
  }
  const sorted = lumas.sort(); // typed arrays sort numerically
  const mRg = sumRg / n, mYb = sumYb / n;
  const sdRg = Math.sqrt(Math.max(0, sumRg2 / n - mRg * mRg));
  const sdYb = Math.sqrt(Math.max(0, sumYb2 / n - mYb * mYb));
  const p5 = percentile(sorted, 0.05);
  const p95 = percentile(sorted, 0.95);
  return {
    lumaP5: p5,
    lumaP95: p95,
    spread: p95 - p5,
    colourfulness: Math.hypot(sdRg, sdYb) + 0.3 * Math.hypot(mRg, mYb),
    meanLab: [sumL / n, sumA / n, sumB / n],
  };
}

/**
 * Median relative luminance of the pixels under `rect` ({x,y,w,h} in bitmap pixels), sampled on a
 * grid of at most `max` points per side. Used on a capture with the text hidden, so it is what the
 * text sits on.
 */
function backdropLuminance(bitmap, width, height, rect, max = 24) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const sx = Math.max(1, (x1 - x0) / max);
  const sy = Math.max(1, (y1 - y0) / max);
  const values = [];
  for (let y = y0; y < y1; y += sy) {
    for (let x = x0; x < x1; x += sx) {
      const [r, g, b] = rgbAt(bitmap, Math.floor(y) * width + Math.floor(x));
      values.push(relativeLuminance(r, g, b));
    }
  }
  values.sort((a, b) => a - b);
  return percentile(values, 0.5);
}

module.exports = { relativeLuminance, contrastRatio, rgbToLab, deltaE, pixelStats, backdropLuminance };
