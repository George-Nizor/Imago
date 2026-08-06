import type { BeautySettings } from '../types/document';
import { loadImage } from './imageUtils';

/**
 * Lightweight beauty pass without heavy face ML:
 * skin-tone-aware bilateral-ish smooth + mild eye/teeth lift via luminance masks.
 * Strength driven by BeautySettings.amount (0-100).
 */
export async function applyBeautyPass(
  src: string,
  beauty: BeautySettings,
): Promise<string> {
  const amount = Math.max(0, Math.min(100, beauty.amount)) / 100;
  if (amount <= 0.01) return src;

  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const smoothStrength = amount * beauty.smooth;
  if (smoothStrength > 0.05) {
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = w;
    blurCanvas.height = h;
    const bctx = blurCanvas.getContext('2d')!;
    const radius = Math.max(2, Math.round(Math.min(w, h) * 0.008 * (0.5 + smoothStrength)));
    bctx.filter = `blur(${radius}px)`;
    bctx.drawImage(img, 0, 0);

    const orig = ctx.getImageData(0, 0, w, h);
    const blurred = bctx.getImageData(0, 0, w, h);
    const d = orig.data;
    const b = blurred.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 10) continue;
      const r = d[i];
      const g = d[i + 1];
      const bl = d[i + 2];
      const skin = isSkinTone(r, g, bl) ? 1 : 0.15;
      const t = smoothStrength * skin;
      d[i] = r * (1 - t) + b[i] * t;
      d[i + 1] = g * (1 - t) + b[i + 1] * t;
      d[i + 2] = bl * (1 - t) + b[i + 2] * t;
    }
    ctx.putImageData(orig, 0, 0);
  }

  // Mild global lifts approximating eyes/teeth/under-eye when amount is high
  const eyeAmt = amount * beauty.eyes * 0.12;
  const teethAmt = amount * beauty.teeth * 0.1;
  const underAmt = amount * beauty.underEye * 0.08;
  if (eyeAmt + teethAmt + underAmt > 0.01) {
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 10) continue;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // brighten lighter midtones slightly (eyes / catchlights proxy)
      if (lum > 90 && lum < 200 && !isSkinTone(r, g, b)) {
        d[i] = clamp(r + 255 * eyeAmt);
        d[i + 1] = clamp(g + 255 * eyeAmt);
        d[i + 2] = clamp(b + 255 * eyeAmt);
      }
      // whiten bright near-neutral pixels (teeth proxy)
      if (lum > 160 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25) {
        d[i] = clamp(r + 255 * teethAmt);
        d[i + 1] = clamp(g + 255 * teethAmt);
        d[i + 2] = clamp(b + 255 * teethAmt * 0.9);
      }
      // soften darker skin midtones (under-eye proxy)
      if (isSkinTone(r, g, b) && lum < 110) {
        d[i] = clamp(r + 255 * underAmt);
        d[i + 1] = clamp(g + 255 * underAmt);
        d[i + 2] = clamp(b + 255 * underAmt);
      }
    }
    ctx.putImageData(data, 0, 0);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('beauty failed'));
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
}

function isSkinTone(r: number, g: number, b: number): boolean {
  return (
    r > 60 &&
    g > 30 &&
    b > 15 &&
    r > g &&
    r > b &&
    r - g > 10 &&
    Math.abs(r - g) > 8 &&
    r - b > 15
  );
}

function clamp(n: number) {
  return Math.max(0, Math.min(255, n));
}
