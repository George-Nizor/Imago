/**
 * Liquid-chrome title reveal — multi-frame animation → animated GIF.
 * Uses the v4 modern look language (mesh plate + chrome type + floor reflection).
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import {
  ensureFontsRegistered,
  renderTextSprite,
  drawSprite,
} from './typography.js';
import { renderMeshPlate } from './modern.js';
import { EXPORTS_DIR, ensureDirs } from './paths.js';

const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require('gifenc') as {
  GIFEncoder: (opts?: { auto?: boolean }) => {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: number[][]; delay?: number; repeat?: number },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  quantize: (rgba: Uint8Array, maxColors: number) => number[][];
  applyPalette: (rgba: Uint8Array, palette: number[][]) => Uint8Array;
};

const W = 960;
const H = 540;
const FPS = 10;
const FRAME_COUNT = 18;
const ACCENT = '#8eb6ff';
const ACCENT2 = '#ff9ec8';
const IVORY = '#f4f1ea';

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function clamp01(t: number) {
  return Math.max(0, Math.min(1, t));
}

async function renderFrame(i: number, total: number): Promise<Buffer> {
  ensureFontsRegistered();
  const t = i / (total - 1);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Shared plate so mesh doesn't flicker frame-to-frame
  const plate = renderMeshPlate(W, H, [ACCENT, ACCENT2, '#a8c0ff', '#ffd4a8'], 42);
  ctx.drawImage(await loadImage(plate), 0, 0);

  // Center veil deepens then holds
  const veilAmt = 0.2 + 0.2 * easeOutCubic(clamp01(t * 1.4));
  const veil = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.55);
  veil.addColorStop(0, `rgba(0,0,0,${veilAmt})`);
  veil.addColorStop(1, 'rgba(0,0,0,0.04)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);

  // Kicker — fades in mid-reveal
  const kickerT = easeOutCubic(clamp01((t - 0.15) / 0.35));
  if (kickerT > 0.02) {
    const k = await renderTextSprite({
      text: 'PREMIERE',
      fontFamily: 'Space Grotesk Medium',
      fontSize: Math.round(H * 0.028),
      tracking: 0.42,
      uppercase: true,
      fill: { kind: 'solid', color: `rgba(244,241,234,${0.65 * kickerT})` },
    });
    drawSprite(ctx, k, W / 2, H * 0.3, {});
  }

  // Hero chrome — scale + opacity rise
  const heroT = easeOutCubic(clamp01((t - 0.05) / 0.55));
  const scale = 0.82 + 0.18 * heroT;
  const size = Math.round(H * 0.2 * scale);
  if (heroT > 0.02) {
    const chrome = await renderTextSprite({
      text: 'VELOCITY',
      fontFamily: 'Space Grotesk Bold',
      fontSize: size,
      tracking: -0.03,
      uppercase: true,
      fill: {
        kind: 'gradient',
        stops: [
          [0, '#ffffff'],
          [0.12, ACCENT],
          [0.28, '#6a7384'],
          [0.42, '#f0f3f8'],
          [0.55, ACCENT2],
          [0.7, '#3a4050'],
          [0.85, '#dce4f0'],
          [1, '#8a93a4'],
        ],
      },
      bevel: true,
      sheen: true,
      opacity: heroT,
    });
    drawSprite(ctx, chrome, W / 2, H * 0.48, {
      softShadow: { blur: size * 0.5, dy: size * 0.1, alpha: 0.65 * heroT },
      glow: { color: `rgba(142,182,255,${0.35 * heroT})`, blur: size * 0.35 },
    });

    // Floor reflection fades in after hero is mostly up
    const reflT = easeInOut(clamp01((t - 0.35) / 0.4));
    if (reflT > 0.02) {
      ctx.save();
      ctx.translate(0, H * 0.48 + chrome.height * 0.55);
      ctx.scale(1, -0.55);
      ctx.globalAlpha = 0.22 * reflT;
      const fade = ctx.createLinearGradient(0, 0, 0, chrome.height);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      const refl = createCanvas(W, chrome.height);
      const rctx = refl.getContext('2d');
      rctx.drawImage(chrome.canvas, (W - chrome.width) / 2, 0);
      rctx.globalCompositeOperation = 'destination-in';
      rctx.fillStyle = fade;
      rctx.fillRect(0, 0, W, chrome.height);
      ctx.drawImage(refl, 0, -chrome.height);
      ctx.restore();
    }
  }

  // Subtitle last
  const subT = easeOutCubic(clamp01((t - 0.55) / 0.35));
  if (subT > 0.02) {
    const sub = await renderTextSprite({
      text: 'Reflective type · Volume One',
      fontFamily: 'Inter',
      fontSize: Math.round(H * 0.03),
      fill: { kind: 'solid', color: `rgba(244,241,234,${0.7 * subT})` },
    });
    drawSprite(ctx, sub, W / 2, H * 0.72, {});
  }

  return canvas.toBuffer('image/png');
}

async function main() {
  ensureDirs();
  console.log(`Rendering ${FRAME_COUNT} frames @ ${FPS}fps…`);

  const gif = GIFEncoder();
  const delay = Math.round(1000 / FPS);
  const framePaths: string[] = [];

  for (let i = 0; i < FRAME_COUNT; i++) {
    const png = await renderFrame(i, FRAME_COUNT);
    const framePath = join(EXPORTS_DIR, `anim_velocity_f${String(i + 1).padStart(2, '0')}.png`);
    writeFileSync(framePath, png);
    framePaths.push(framePath);

    // Flatten for GIF (opaque)
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Composite onto dark if any transparency
    const rgba = Buffer.alloc(info.width * info.height * 4);
    for (let p = 0; p < data.length; p += 4) {
      const a = data[p + 3] / 255;
      rgba[p] = Math.round(data[p] * a);
      rgba[p + 1] = Math.round(data[p + 1] * a);
      rgba[p + 2] = Math.round(data[p + 2] * a);
      rgba[p + 3] = 255;
    }
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, info.width, info.height, {
      palette,
      delay,
      repeat: 0,
    });
    process.stdout.write(`  frame ${i + 1}/${FRAME_COUNT}\n`);
  }

  gif.finish();
  const bytes = gif.bytes();
  const out = join(EXPORTS_DIR, 'anim_velocity_chrome.gif');
  writeFileSync(out, Buffer.from(bytes));
  console.log(`GIF → ${out}`);
  console.log(`PNG frames → ${framePaths[0]} … ${framePaths[framePaths.length - 1]}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
