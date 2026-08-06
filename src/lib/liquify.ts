/**
 * Mesh-based Liquify using displacement maps.
 * Modes: warp (push), bloat, pucker.
 * Runs at previewScale then upscales for MacBook Air friendliness.
 */

export type LiquifyMode = 'warp' | 'bloat' | 'pucker';

export async function liquifyStroke(
  src: string,
  mode: LiquifyMode,
  points: { x: number; y: number }[],
  radius: number,
  strength: number,
  previewScale = 0.5,
): Promise<string> {
  const blob = await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const w = bmp.width;
  const h = bmp.height;

  const pw = Math.max(1, Math.round(w * previewScale));
  const ph = Math.max(1, Math.round(h * previewScale));

  const srcC = document.createElement('canvas');
  srcC.width = pw;
  srcC.height = ph;
  const sctx = srcC.getContext('2d')!;
  sctx.drawImage(bmp, 0, 0, pw, ph);
  const srcData = sctx.getImageData(0, 0, pw, ph);

  const outC = document.createElement('canvas');
  outC.width = pw;
  outC.height = ph;
  const octx = outC.getContext('2d')!;
  const out = octx.createImageData(pw, ph);

  const mapX = new Float32Array(pw * ph);
  const mapY = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = y * pw + x;
      mapX[i] = x;
      mapY[i] = y;
    }
  }

  const r = radius * previewScale;
  const r2 = r * r;

  for (let p = 1; p < points.length; p++) {
    const cx = points[p].x * previewScale;
    const cy = points[p].y * previewScale;
    const dx = (points[p].x - points[p - 1].x) * previewScale;
    const dy = (points[p].y - points[p - 1].y) * previewScale;

    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(pw - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(ph - 1, Math.ceil(cy + r));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ox = x - cx;
        const oy = y - cy;
        const d2 = ox * ox + oy * oy;
        if (d2 > r2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const t = 1 - d / r;
        const falloff = t * t * (3 - 2 * t);
        const i = y * pw + x;

        if (mode === 'warp') {
          mapX[i] -= dx * falloff * strength;
          mapY[i] -= dy * falloff * strength;
        } else if (mode === 'bloat') {
          const push = falloff * strength * r * 0.15;
          mapX[i] -= (ox / d) * push;
          mapY[i] -= (oy / d) * push;
        } else {
          const pull = falloff * strength * r * 0.15;
          mapX[i] += (ox / d) * pull;
          mapY[i] += (oy / d) * pull;
        }
      }
    }
  }

  const sd = srcData.data;
  const od = out.data;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = y * pw + x;
      const sx = mapX[i];
      const sy = mapY[i];
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(pw - 1, x0 + 1);
      const y1 = Math.min(ph - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const oi = i * 4;

      if (x0 < 0 || y0 < 0 || x0 >= pw || y0 >= ph) {
        od[oi + 3] = 0;
        continue;
      }

      const i00 = (y0 * pw + x0) * 4;
      const i10 = (y0 * pw + x1) * 4;
      const i01 = (y1 * pw + x0) * 4;
      const i11 = (y1 * pw + x1) * 4;

      for (let c = 0; c < 4; c++) {
        const v00 = sd[i00 + c];
        const v10 = sd[i10 + c];
        const v01 = sd[i01 + c];
        const v11 = sd[i11 + c];
        od[oi + c] =
          v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy;
      }
    }
  }
  octx.putImageData(out, 0, 0);

  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const fctx = full.getContext('2d')!;
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(outC, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    full.toBlob((b) => {
      if (!b) reject(new Error('liquify failed'));
      else resolve(URL.createObjectURL(b));
    }, 'image/png');
  });
}
