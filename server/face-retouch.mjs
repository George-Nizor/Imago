// Local, classic photo retouching of a face-pack cut-out: tone and texture only, never geometry or
// identity. Same size, same alpha. Steps (each scaled by `strength`, 0 to 1): white balance measured on
// the skin inside the face box, exposure and levels, a little warmth and vibrance, edge-preserving skin
// smoothing, redness reduction and a light unsharp mask. Everything is plain typed-array maths on top of
// sharp's decode and encode, so it needs no model and no subscription.
import fs from "node:fs/promises";

export const DEFAULT_RETOUCH_STRENGTH = 0.5;
export const ALL_STEPS = ["balance", "tone", "warmth", "smooth", "redness", "sharpen"];
const MAX_PIXELS = 100_000_000;

// What healthy skin looks like in R/G and B/G once the light is neutral. A photo whose face sits outside
// this band has a cast; white balance moves it toward the band and never past its edge.
const SKIN_BAND = { rg: [1.14, 1.4], bg: [0.74, 0.9] };
// Flattering portraits sit a little above middle grey: skin below this is lifted toward it.
const TARGET_LUMA = 0.58;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---- small image maths ----------------------------------------------------------------------------

/** One box-blur pass of radius r over a float plane (edge pixels repeat). */
function boxBlur(src, w, h, r, out = new Float32Array(src.length)) {
  if (r < 1) {
    out.set(src);
    return out;
  }
  const tmp = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let sum = src[row] * (r + 1);
    for (let i = 1; i <= r; i += 1) sum += src[row + Math.min(i, w - 1)];
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = sum * inv;
      sum += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x += 1) {
    let sum = tmp[x] * (r + 1);
    for (let i = 1; i <= r; i += 1) sum += tmp[Math.min(i, h - 1) * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = sum * inv;
      sum += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
  return out;
}

/** Gaussian-like blur (three box passes) of the given sigma. */
function blur(src, w, h, sigma) {
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5));
  let a = boxBlur(src, w, h, r);
  let b = boxBlur(a, w, h, r);
  a = boxBlur(b, w, h, r, a);
  return a;
}

/** He et al.'s guided filter: smooths `p` but keeps the edges that exist in the guide `I`. */
function guidedFilter(I, p, w, h, r, eps) {
  const n = I.length;
  const mI = boxBlur(I, w, h, r);
  const mP = boxBlur(p, w, h, r);
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    ip[i] = I[i] * p[i];
    ii[i] = I[i] * I[i];
  }
  const mIP = boxBlur(ip, w, h, r);
  const mII = boxBlur(ii, w, h, r);
  const a = ip;
  const b = ii;
  for (let i = 0; i < n; i += 1) {
    const cov = mIP[i] - mI[i] * mP[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const ma = boxBlur(a, w, h, r);
  const mb = boxBlur(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = ma[i] * I[i] + mb[i];
  return out;
}

/** Variance of the 4-neighbour Laplacian of a luma plane over a rectangle; a stand-in for "high-frequency energy". */
export function highFrequencyEnergy(luma, width, region) {
  const { x0, y0, x1, y1 } = region;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = Math.max(1, y0); y < y1 - 1; y += 1) {
    for (let x = Math.max(1, x0); x < x1 - 1; x += 1) {
      const i = y * width + x;
      const v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width];
      sum += v;
      sq += v * v;
      n += 1;
    }
  }
  const mean = sum / n;
  return sq / n - mean * mean;
}

// ---- skin -----------------------------------------------------------------------------------------

/** Per-pixel skin likelihood from colour alone (YCbCr band, red above green, not too dark). */
function skinLikelihood(r, g, b) {
  const R = r * 255;
  const G = g * 255;
  const B = b * 255;
  const Y = lumaOf(r, g, b);
  const cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
  const cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
  const sCb = smoothstep(70, 80, cb) * (1 - smoothstep(122, 132, cb));
  const sCr = smoothstep(126, 136, cr) * (1 - smoothstep(172, 184, cr));
  const warm = smoothstep(0, 0.03, r - g) * smoothstep(-0.02, 0.02, g - b * 0.92);
  return sCb * sCr * warm * smoothstep(0.1, 0.24, Y);
}

/** The face box as pixels, clipped, with the margins the retouch works over (a little hair, the neck). */
function regionOf(box, width, height) {
  const x = box.x * width;
  const y = box.y * height;
  const bw = box.w * width;
  const bh = box.h * height;
  return {
    core: { x0: Math.round(x), y0: Math.round(y), x1: Math.round(x + bw), y1: Math.round(y + bh) },
    work: {
      x0: clamp(Math.round(x - 0.14 * bw), 0, width),
      y0: clamp(Math.round(y - 0.04 * bh), 0, height),
      x1: clamp(Math.round(x + 1.14 * bw), 0, width),
      y1: clamp(Math.round(y + 1.3 * bh), 0, height),
    },
    faceHeight: Math.max(8, bh),
  };
}

/** A box around the subject's upper body for a photo that has no face box yet (the cut-out runs before the labels). */
export function fallbackBox(alpha, width, height) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 400));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (alpha[y * width + x] > 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0.3, y: 0.1, w: 0.4, h: 0.4 };
  // Head and neck are the top of the subject; its width is taken from the widest part of the top slice.
  const subjectH = maxY - minY;
  const headH = Math.min(subjectH, (maxX - minX) * 0.55, subjectH * 0.36);
  const rowMin = (row) => {
    for (let x = 0; x < width; x += step) if (alpha[row * width + x] > 128) return x;
    return width;
  };
  const rowMax = (row) => {
    for (let x = width - 1; x >= 0; x -= step) if (alpha[row * width + x] > 128) return x;
    return 0;
  };
  const probe = clamp(Math.round(minY + headH * 0.5), 0, height - 1);
  const x0 = rowMin(probe);
  const x1 = rowMax(probe);
  const bw = Math.max(8, (x1 - x0) * 0.9);
  const cx = (x0 + x1) / 2;
  const bx = clamp(cx - bw / 2, 0, width - 8);
  return {
    x: bx / width,
    y: (minY + headH * 0.12) / height,
    w: Math.min(bw, width - bx) / width,
    h: (headH * 0.88) / height,
  };
}

/**
 * Measures the skin inside the box: colour means, ratios and median luma. `rgb` is a float image (three
 * planes). Used by the retouch itself and by the tests, so a step can be judged by the same numbers.
 */
export function measureSkin({ planes, alpha, width, height, box }) {
  const { core } = regionOf(box, width, height);
  const lumas = [];
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let y = core.y0; y < core.y1; y += 1) {
    for (let x = core.x0; x < core.x1; x += 1) {
      const i = y * width + x;
      if (alpha[i] < 240) continue;
      const r = planes[0][i];
      const g = planes[1][i];
      const b = planes[2][i];
      if (skinLikelihood(r, g, b) < 0.6) continue;
      const Y = lumaOf(r, g, b);
      if (Y < 0.18 || Y > 0.95) continue;
      sr += r;
      sg += g;
      sb += b;
      n += 1;
      if (n % 3 === 0) lumas.push(Y);
    }
  }
  if (n < 50) return null;
  lumas.sort((p, q) => p - q);
  const r = sr / n;
  const g = sg / n;
  const b = sb / n;
  return { r, g, b, rg: r / g, bg: b / g, luma: lumas[Math.floor(lumas.length / 2)], count: n };
}

/** How far the skin's colour ratios sit outside the healthy band (0 inside it); the "cast". */
export function castOf(skin) {
  const out = (v, [lo, hi]) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  return Math.hypot(out(skin.rg, SKIN_BAND.rg), out(skin.bg, SKIN_BAND.bg));
}

// ---- the retouch ----------------------------------------------------------------------------------

/**
 * Retouches an RGBA image. `rgba` is a Buffer (8-bit, straight alpha). The cut-out carries the photo's own
 * colours unchanged (checked: under the alpha it differs from the upright photo by under a tenth of a level),
 * so the skin is measured on it directly. `box` is the face box as 0-1 fractions, `strength` 0 to 1, `steps` the steps to run (all by default).
 * Returns {data (a new RGBA buffer, alpha untouched), report}.
 */
export function retouchPixels({ rgba, channels = 4, width, height, box, strength = DEFAULT_RETOUCH_STRENGTH, steps = ALL_STEPS }) {
  const s = clamp(Number(strength), 0, 1);
  const on = new Set(steps);
  const n = width * height;
  const alpha = new Uint8Array(n);
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i += 1) {
    planes[0][i] = rgba[i * channels] / 255;
    planes[1][i] = rgba[i * channels + 1] / 255;
    planes[2][i] = rgba[i * channels + 2] / 255;
    alpha[i] = channels === 4 ? rgba[i * channels + 3] : 255;
  }
  const faceBox = box ?? fallbackBox(alpha, width, height);
  const report = { strength: s, box: faceBox, steps: [] };
  if (s <= 0) return { data: Buffer.from(rgba), report };

  const region = regionOf(faceBox, width, height);
  const skinBefore = measureSkin({ planes, alpha, width, height, box: faceBox });
  report.before = skinBefore;
  const skinMedian = skinBefore?.luma ?? TARGET_LUMA;

  const [R, G, B] = planes;

  // 1. White balance: pull the skin's colour ratios into the healthy band, never past its edge.
  if (on.has("balance") && skinBefore) {
    const pull = (v, [lo, hi]) => (v < lo ? lo / v : v > hi ? hi / v : 1);
    const gr = 1 + (pull(skinBefore.rg, SKIN_BAND.rg) - 1) * s;
    const gb = 1 + (pull(skinBefore.bg, SKIN_BAND.bg) - 1) * s;
    const gR = clamp(gr, 0.85, 1.2);
    const gB = clamp(gb, 0.85, 1.2);
    // Keep luma where it was so the cast fix is not also an exposure change.
    const norm = 1 / (0.299 * gR + 0.587 + 0.114 * gB);
    for (let i = 0; i < n; i += 1) {
      R[i] = clamp(R[i] * gR * norm, 0, 1);
      G[i] = clamp(G[i] * norm, 0, 1);
      B[i] = clamp(B[i] * gB * norm, 0, 1);
    }
    report.steps.push({ step: "balance", gains: [gR * norm, norm, gB * norm] });
  }

  // 2. Exposure and levels: one luma curve (skin mid-tones to a healthy brightness, shadows lifted by gamma, a gentle
  //    S-curve), black protected so a dark T-shirt stays black. Applied as a luma ratio so hue and saturation hold.
  if (on.has("tone")) {
    const measured = measureSkin({ planes, alpha, width, height, box: faceBox });
    const Ls = measured?.luma ?? skinMedian;
    const wanted = Ls < TARGET_LUMA ? Math.log(TARGET_LUMA) / Math.log(Math.max(Ls, 0.05)) : Ls > 0.72 ? Math.log(0.68) / Math.log(Ls) : 1;
    const gamma = clamp(1 + (wanted - 1) * Math.min(1, s * 1.1), 0.7, 1.15);
    const contrast = 0.08 * s;
    // The S-curve pivots on the (lifted) skin itself, so contrast deepens what is darker than the face and
    // brightens what is lighter, and never pulls the skin down into a duller tone.
    const pivot = clamp(Math.pow(Ls, gamma), 0.2, 0.8);
    const lut = new Float32Array(1025);
    for (let k = 0; k <= 1024; k += 1) {
      const y = k / 1024;
      const lifted = Math.pow(y, gamma);
      const guard = smoothstep(0.07, 0.3, y); // blacks stay black
      let v = y + (lifted - y) * guard;
      const t = v < pivot ? (0.5 * v) / pivot : 0.5 + (0.5 * (v - pivot)) / (1 - pivot);
      const t2 = t - (contrast * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
      v = t2 < 0.5 ? (t2 / 0.5) * pivot : pivot + ((t2 - 0.5) / 0.5) * (1 - pivot);
      lut[k] = clamp(v, 0, 1);
    }
    for (let i = 0; i < n; i += 1) {
      const y = lumaOf(R[i], G[i], B[i]);
      if (y < 0.002) continue;
      const k = y * 1024;
      const lo = Math.floor(k);
      const target = lut[lo] + (lut[Math.min(1024, lo + 1)] - lut[lo]) * (k - lo);
      const ratio = target / y;
      let r = R[i] * ratio;
      let g = G[i] * ratio;
      let b = B[i] * ratio;
      const m = Math.max(r, g, b);
      if (m > 1) {
        // Hold the highlight's hue rather than clipping a channel.
        const over = 1 / m;
        r *= over;
        g *= over;
        b *= over;
      }
      R[i] = r;
      G[i] = g;
      B[i] = b;
    }
    report.steps.push({ step: "tone", gamma, contrast, pivot, from: Ls });
  }

  // 3. A little warmth and vibrance on the mid-tones, capped so skin never turns orange.
  if (on.has("warmth")) {
    const skin = measureSkin({ planes, alpha, width, height, box: faceBox });
    let warm = 0.035 * s;
    if (skin) warm = Math.min(warm, Math.max(0, (SKIN_BAND.rg[1] + 0.05 - skin.rg) / skin.rg));
    const vib = 0.22 * s;
    for (let i = 0; i < n; i += 1) {
      const y = lumaOf(R[i], G[i], B[i]);
      const mid = smoothstep(0.08, 0.3, y) * (1 - smoothstep(0.85, 1, y));
      if (mid <= 0) continue;
      let r = R[i] * (1 + warm * mid);
      let g = G[i];
      let b = B[i] * (1 - warm * 0.9 * mid);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      // Vibrance: lift weakly saturated colours more than strong ones, and leave skin's own warmth alone.
      const k = 1 + vib * (1 - sat) * (1 - sat) * mid;
      const yy = lumaOf(r, g, b);
      r = clamp(yy + (r - yy) * k, 0, 1);
      g = clamp(yy + (g - yy) * k, 0, 1);
      b = clamp(yy + (b - yy) * k, 0, 1);
      R[i] = r;
      G[i] = g;
      B[i] = b;
    }
    report.steps.push({ step: "warmth", warm });
  }

  // 4 and 5. Smoothing and redness work on the face crop only.
  const smoothing = on.has("smooth") || on.has("redness");
  if (smoothing) {
    const { x0, y0, x1, y1 } = region.work;
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw > 16 && ch > 16) {
      const m = cw * ch;
      const crop = [new Float32Array(m), new Float32Array(m), new Float32Array(m)];
      const ca = new Uint8Array(m);
      const skinP = new Float32Array(m);
      const Y = new Float32Array(m);
      for (let y = 0; y < ch; y += 1) {
        for (let x = 0; x < cw; x += 1) {
          const i = (y + y0) * width + (x + x0);
          const j = y * cw + x;
          crop[0][j] = R[i];
          crop[1][j] = G[i];
          crop[2][j] = B[i];
          ca[j] = alpha[i];
          Y[j] = lumaOf(R[i], G[i], B[i]);
          // Skin tone is judged on the tone-adjusted pixel; the box and alpha bound it.
          skinP[j] = skinLikelihood(R[i], G[i], B[i]) * (alpha[i] / 255);
        }
      }
      const fh = region.faceHeight;
      // Colour under the cut-out's soft edge is unreliable (often black), so every filter below sees the subject's own
      // colours spread outward over it; otherwise the rim would darken and the redness reference would be dragged down.
      {
        const fillSigma = Math.max(2, fh * 0.02);
        const weight = new Float32Array(m);
        for (let j = 0; j < m; j += 1) weight[j] = ca[j] >= 250 ? 1 : (ca[j] / 255) ** 2;
        const den = blur(weight, cw, ch, fillSigma);
        for (let c = 0; c < 3; c += 1) {
          const premult = new Float32Array(m);
          for (let j = 0; j < m; j += 1) premult[j] = crop[c][j] * weight[j];
          const num = blur(premult, cw, ch, fillSigma);
          for (let j = 0; j < m; j += 1) if (ca[j] < 250 && den[j] > 0.02) crop[c][j] = num[j] / den[j];
        }
        for (let j = 0; j < m; j += 1) Y[j] = lumaOf(crop[0][j], crop[1][j], crop[2][j]);
      }
      // The mask: skin-coloured, inside the feathered box, not near hair, brows, lashes or lips.
      const dark = new Float32Array(m);
      for (let j = 0; j < m; j += 1) dark[j] = 1 - smoothstep(0.5, 0.78, Y[j] / skinMedian);
      const darkSpread = blur(dark, cw, ch, Math.max(2, fh * 0.012));
      // Local texture (gradient of a lightly blurred luma): eyes, brows, lips and beard edges stand out in it.
      const soft = blur(Y, cw, ch, Math.max(1, fh * 0.003));
      const mask = new Float32Array(m);
      const feather = Math.max(4, Math.min(cw, ch) * 0.16);
      for (let y = 0; y < ch; y += 1) {
        const fy = smoothstep(0, feather, Math.min(y, ch - 1 - y));
        for (let x = 0; x < cw; x += 1) {
          const j = y * cw + x;
          const fx = smoothstep(0, feather, Math.min(x, cw - 1 - x));
          let gx = 0;
          let gy = 0;
          if (x > 0 && x < cw - 1 && y > 0 && y < ch - 1) {
            gx = soft[j + 1] - soft[j - 1];
            gy = soft[j + cw] - soft[j - cw];
          }
          const edge = smoothstep(0.012, 0.045, Math.hypot(gx, gy));
          const protect = Math.min(1, darkSpread[j] * 3);
          mask[j] = skinP[j] * fx * fy * (1 - protect) * (1 - edge);
        }
      }
      const maskSoft = blur(mask, cw, ch, Math.max(1.5, fh * 0.006));
      for (let j = 0; j < m; j += 1) maskSoft[j] = Math.min(mask[j] > 0.02 ? 1 : 0.6, maskSoft[j]) * Math.min(1, maskSoft[j] * 1.2);

      if (on.has("smooth")) {
        const r = Math.max(3, Math.round(fh * 0.011));
        const eps = 0.0025;
        const amount = Math.min(1, s) * 0.55;
        for (let c = 0; c < 3; c += 1) {
          let sm = guidedFilter(Y, crop[c], cw, ch, r, eps);
          sm = guidedFilter(Y, sm, cw, ch, Math.max(2, Math.round(r * 0.6)), eps);
          const plane = crop[c];
          for (let j = 0; j < m; j += 1) plane[j] += (sm[j] - plane[j]) * maskSoft[j] * amount;
        }
        report.steps.push({ step: "smooth", radius: r, amount });
      }

      if (on.has("redness")) {
        // How much redder than its surroundings each skin pixel is; blemishes and flushes. Reduced, not removed.
        const ex = new Float32Array(m);
        for (let j = 0; j < m; j += 1) ex[j] = crop[0][j] - 0.5 * (crop[1][j] + crop[2][j]);
        const around = blur(ex, cw, ch, Math.max(4, fh * 0.07));
        const k = 0.75 * s;
        for (let j = 0; j < m; j += 1) {
          const over = ex[j] - around[j] - 0.004;
          if (over <= 0) continue;
          const take = over * k * Math.min(1, maskSoft[j] * 1.3);
          crop[0][j] -= take;
          // Give a part of the luma back so the spot does not turn into a dark patch.
          crop[1][j] += take * 0.25;
          crop[2][j] += take * 0.25;
        }
        // And a general flush down: skin that is redder than the face's own average, pulled a few percent toward it.
        report.steps.push({ step: "redness", k });
      }
      for (let y = 0; y < ch; y += 1) {
        for (let x = 0; x < cw; x += 1) {
          const i = (y + y0) * width + (x + x0);
          const j = y * cw + x;
          R[i] = clamp(crop[0][j], 0, 1);
          G[i] = clamp(crop[1][j], 0, 1);
          B[i] = clamp(crop[2][j], 0, 1);
        }
      }
    }
  }

  // 6. Unsharp mask on the luma of the whole subject, weighted by alpha so the cut-out's edge does not halo; gentler on skin.
  if (on.has("sharpen")) {
    const sigma = clamp(height * 0.0007, 1, 3);
    const Ya = new Float32Array(n);
    const A = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      A[i] = alpha[i] / 255;
      Ya[i] = lumaOf(R[i], G[i], B[i]) * A[i];
    }
    const num = blur(Ya, width, height, sigma);
    const den = blur(A, width, height, sigma);
    const wideNum = blur(Ya, width, height, sigma * 5);
    const wideDen = blur(A, width, height, sigma * 5);
    const amount = 0.55 * s;
    const clarity = 0.18 * s;
    for (let i = 0; i < n; i += 1) {
      if (A[i] < 0.02 || den[i] < 0.5) continue;
      const y = lumaOf(R[i], G[i], B[i]);
      const fine = y - num[i] / den[i];
      const wide = y - wideNum[i] / wideDen[i];
      // Skin keeps its softness; everything else (eyes, hair, beard, shirt, the outline) gets the full amount.
      const sk = skinLikelihood(R[i], G[i], B[i]);
      const k = amount * (1 - 0.6 * sk);
      const delta = clamp(fine * k + wide * clarity * (1 - 0.5 * sk), -0.09, 0.09) * Math.min(1, A[i] * 2);
      R[i] = clamp(R[i] + delta, 0, 1);
      G[i] = clamp(G[i] + delta, 0, 1);
      B[i] = clamp(B[i] + delta, 0, 1);
    }
    report.steps.push({ step: "sharpen", sigma, amount });
  }

  const data = Buffer.allocUnsafe(n * 4);
  for (let i = 0; i < n; i += 1) {
    data[i * 4] = Math.round(R[i] * 255);
    data[i * 4 + 1] = Math.round(G[i] * 255);
    data[i * 4 + 2] = Math.round(B[i] * 255);
    data[i * 4 + 3] = alpha[i];
  }
  report.after = measureSkin({ planes, alpha, width, height, box: faceBox });
  return { data, report };
}

/**
 * Retouches the cut-out PNG at `cutout` and writes the PNG to `destination`. The result has the cut-out's
 * size and exactly its alpha. Returns {width, height, report}.
 */
export async function retouchFile({ cutout, destination, box = null, strength = DEFAULT_RETOUCH_STRENGTH, steps = ALL_STEPS }) {
  const sharp = (await import("sharp")).default;
  const cut = await sharp(await fs.readFile(cutout), { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = cut.info;
  const { data, report } = retouchPixels({ rgba: cut.data, channels: 4, width, height, box, strength, steps });
  const tmp = `${destination}.tmp`;
  await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 4 }).toFile(tmp);
  await fs.rename(tmp, destination);
  return { width, height, report };
}
