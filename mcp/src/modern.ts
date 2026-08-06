import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureFontsRegistered,
  renderTextSprite,
  drawSprite,
  wrapText,
  type FillSpec,
} from './typography.js';
import { EXPORTS_DIR, ensureDirs, slugify } from './paths.js';

type Ctx = ReturnType<Canvas['getContext']>;

export type ModernLook =
  | 'mesh-poster'
  | 'liquid-chrome'
  | 'neon-grid'
  | 'duotone-photo'
  | 'glass-over-photo'
  | 'depth-stack'
  | 'magazine'
  | 'brutalist'
  | 'aurora-type';

export interface ModernArtefactRequest {
  look: ModernLook;
  title: string;
  subtitle?: string;
  kicker?: string;
  /** Real photo to integrate with */
  photoPath?: string;
  /** Accent hex for neon / mesh / duotone */
  accent?: string;
  /** Secondary accent */
  accent2?: string;
  width?: number;
  height?: number;
  transparent?: boolean;
  outputName?: string;
}

const IVORY = '#f4f1ea';
const INK = '#0b0c10';

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let s = 0;
  for (const c of text) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return (s % 1000) + 1;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function withAlpha(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/* ————————————————————————————————————————————————
 * Modern plates
 * ———————————————————————————————————————————————— */

/** Vibrant overlapping radial mesh — no cinematic vignette. */
export function renderMeshPlate(
  width: number,
  height: number,
  accents: string[],
  seed = 11,
): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(seed);

  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, '#07080f');
  base.addColorStop(1, '#12101a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = 'screen';
  const blobs = [
    [0.18, 0.22, 0.55],
    [0.78, 0.28, 0.5],
    [0.55, 0.78, 0.6],
    [0.3, 0.6, 0.4],
    [0.9, 0.7, 0.35],
  ] as const;
  blobs.forEach(([ax, ay, ar], i) => {
    const color = accents[i % accents.length];
    const g = ctx.createRadialGradient(
      width * (ax + (rng() - 0.5) * 0.06),
      height * (ay + (rng() - 0.5) * 0.06),
      20,
      width * ax,
      height * ay,
      Math.max(width, height) * ar,
    );
    g.addColorStop(0, withAlpha(color, 0.85));
    g.addColorStop(0.55, withAlpha(color, 0.25));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  });

  // Soft noise
  ctx.globalCompositeOperation = 'source-over';
  const img = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] = Math.min(255, Math.max(0, img.data[i] + n));
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] + n));
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  return canvas.toBuffer('image/png');
}

/** Neon perspective grid with horizon glow. */
export function renderNeonGridPlate(
  width: number,
  height: number,
  accent = '#39f3ff',
  accent2 = '#ff3d9a',
): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#05060e');
  sky.addColorStop(0.45, '#0a0c1c');
  sky.addColorStop(0.55, '#12081a');
  sky.addColorStop(1, '#05040a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Horizon glow
  const hz = height * 0.48;
  const glow = ctx.createRadialGradient(width / 2, hz, 10, width / 2, hz, width * 0.55);
  glow.addColorStop(0, withAlpha(accent2, 0.55));
  glow.addColorStop(0.4, withAlpha(accent, 0.2));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Sun disc
  const sun = ctx.createRadialGradient(width / 2, hz, 4, width / 2, hz, 90);
  sun.addColorStop(0, '#fff6d0');
  sun.addColorStop(0.4, withAlpha(accent2, 0.85));
  sun.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(width / 2, hz, 90, 0, Math.PI * 2);
  ctx.fill();

  // Perspective grid floor
  ctx.strokeStyle = withAlpha(accent, 0.55);
  ctx.lineWidth = 1.5;
  const vanishingY = hz;
  const floorTop = hz + 8;
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const y = floorTop + Math.pow(t, 1.6) * (height - floorTop);
    ctx.globalAlpha = 0.25 + t * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let i = -12; i <= 12; i++) {
    const xBottom = width / 2 + i * (width / 10);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(width / 2, vanishingY);
    ctx.lineTo(xBottom, height);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < height; y += 3) ctx.fillRect(0, y, width, 1);

  return canvas.toBuffer('image/png');
}

/** Duotone a photo with two accent colors. */
export async function renderDuotonePhoto(
  photo: Buffer,
  width: number,
  height: number,
  shadows: string,
  highlights: string,
): Promise<Buffer> {
  const [sr, sg, sb] = hexToRgb(shadows);
  const [hr, hg, hb] = hexToRgb(highlights);
  const { data, info } = await sharp(photo)
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .greyscale()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j += 4) {
    const t = data[i] / 255;
    const c = Math.pow(t, 0.9);
    rgba[j] = Math.round(sr + (hr - sr) * c);
    rgba[j + 1] = Math.round(sg + (hg - sg) * c);
    rgba[j + 2] = Math.round(sb + (hb - sb) * c);
    rgba[j + 3] = 255;
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** Soft elliptical subject mask for depth stacking without ML. */
async function softSubjectMask(
  width: number,
  height: number,
  cx = 0.5,
  cy = 0.42,
  rx = 0.28,
  ry = 0.48,
): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const g = ctx.createRadialGradient(
    width * cx,
    height * cy,
    Math.min(width, height) * 0.08,
    width * cx,
    height * cy,
    Math.max(width * rx, height * ry),
  );
  g.addColorStop(0, '#fff');
  g.addColorStop(0.55, '#fff');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(width * cx, height * cy, width * rx, height * ry, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer('image/png');
}

/* ————————————————————————————————————————————————
 * Modern fills
 * ———————————————————————————————————————————————— */

function liquidChromeFill(sampleColors: string[]): FillSpec {
  // Sampled reflection stops — looks like liquid metal reflecting the scene
  const stops: [number, string][] = [
    [0, '#ffffff'],
    [0.12, sampleColors[0] ?? '#c8d4e8'],
    [0.28, '#6a7384'],
    [0.42, '#f0f3f8'],
    [0.55, sampleColors[1] ?? '#9aa8bc'],
    [0.7, '#3a4050'],
    [0.85, sampleColors[2] ?? '#dce4f0'],
    [1, '#8a93a4'],
  ];
  return { kind: 'gradient', stops };
}

function neonFill(accent: string): FillSpec {
  return {
    kind: 'gradient',
    stops: [
      [0, '#ffffff'],
      [0.35, accent],
      [1, accent],
    ],
  };
}

async function samplePhotoColors(photo: Buffer, n = 3): Promise<string[]> {
  const { data } = await sharp(photo)
    .resize(48, 48, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets: { r: number; g: number; b: number; c: number }[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // skip near-black / near-white
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 25 || lum > 230) continue;
    let placed = false;
    for (const bucket of buckets) {
      if (Math.abs(bucket.r - r) + Math.abs(bucket.g - g) + Math.abs(bucket.b - b) < 90) {
        bucket.r = (bucket.r * bucket.c + r) / (bucket.c + 1);
        bucket.g = (bucket.g * bucket.c + g) / (bucket.c + 1);
        bucket.b = (bucket.b * bucket.c + b) / (bucket.c + 1);
        bucket.c++;
        placed = true;
        break;
      }
    }
    if (!placed) buckets.push({ r, g, b, c: 1 });
  }
  buckets.sort((a, b) => b.c - a.c);
  return buckets.slice(0, n).map((b) => {
    const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
    return `#${toHex(b.r)}${toHex(b.g)}${toHex(b.b)}`;
  });
}

/* ————————————————————————————————————————————————
 * Compositions
 * ———————————————————————————————————————————————— */

export async function createModernArtefact(req: ModernArtefactRequest): Promise<{
  outputPath: string;
  width: number;
  height: number;
  look: ModernLook;
  notes: string[];
}> {
  ensureDirs();
  ensureFontsRegistered();
  const notes: string[] = [];
  const width = req.width ?? 1920;
  const height = req.height ?? 1080;
  const accent = req.accent ?? '#7c5cff';
  const accent2 = req.accent2 ?? '#ff4d8d';
  const transparent = req.transparent ?? false;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  switch (req.look) {
    case 'mesh-poster':
      await composeMeshPoster(ctx, width, height, req, accent, accent2);
      break;
    case 'liquid-chrome':
      await composeLiquidChrome(ctx, width, height, req, accent, accent2);
      break;
    case 'neon-grid':
      await composeNeonGrid(ctx, width, height, req, accent, accent2);
      break;
    case 'duotone-photo':
      await composeDuotone(ctx, width, height, req, accent, accent2, notes);
      break;
    case 'glass-over-photo':
      await composeGlassOverPhoto(ctx, width, height, req, notes);
      break;
    case 'depth-stack':
      await composeDepthStack(ctx, width, height, req, notes);
      break;
    case 'magazine':
      await composeMagazine(ctx, width, height, req, accent, notes);
      break;
    case 'brutalist':
      await composeBrutalist(ctx, width, height, req, accent);
      break;
    case 'aurora-type':
      await composeAuroraType(ctx, width, height, req, accent, accent2);
      break;
  }

  const name = slugify(req.outputName ?? `modern_${req.look}_${req.title}`);
  const ext = transparent ? 'png' : 'jpg';
  const outputPath = join(EXPORTS_DIR, `${name}.${ext}`);
  if (transparent) {
    writeFileSync(outputPath, canvas.toBuffer('image/png'));
  } else {
    writeFileSync(
      outputPath,
      await sharp(canvas.toBuffer('image/png')).jpeg({ quality: 94 }).toBuffer(),
    );
  }
  notes.push(`look=${req.look}; ${width}x${height}`);
  return { outputPath, width, height, look: req.look, notes };
}

async function composeMeshPoster(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  accent: string,
  accent2: string,
) {
  const plate = renderMeshPlate(w, h, [accent, accent2, '#45e6ff', '#ffb347'], seedFrom(req.title));
  ctx.drawImage(await loadImage(plate), 0, 0);

  // Small geometric accent — floating pill
  ctx.fillStyle = withAlpha('#ffffff', 0.08);
  roundRect(ctx, w * 0.08, h * 0.12, 160, 36, 18);
  ctx.fill();
  const pill = await renderTextSprite({
    text: req.kicker ?? 'NEW DROP',
    fontFamily: 'Space Grotesk Bold',
    fontSize: 16,
    tracking: 0.22,
    uppercase: true,
    fill: { kind: 'solid', color: IVORY },
  });
  drawSprite(ctx, pill, w * 0.08 + 80, h * 0.12 + 18, {});

  // Massive stacked title — modern tight leading
  const words = req.title.split(/\s+/);
  const size = Math.round(h * (words.length > 2 ? 0.14 : 0.2));
  let y = h * 0.38;
  for (const word of words) {
    const sprite = await renderTextSprite({
      text: word,
      fontFamily: 'Space Grotesk Bold',
      fontSize: size,
      tracking: -0.04,
      uppercase: true,
      fill: { kind: 'solid', color: IVORY },
    });
    drawSprite(ctx, sprite, w * 0.08, y, {
      align: 'left',
      softShadow: { blur: size * 0.25, dy: size * 0.04, alpha: 0.45 },
    });
    y += size * 0.88;
  }

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Inter',
      fontSize: Math.round(h * 0.028),
      tracking: 0.02,
      fill: { kind: 'solid', color: withAlpha(IVORY, 0.7) },
    });
    drawSprite(ctx, sub, w * 0.08, y + h * 0.04, { align: 'left' });
  }

  // Accent bar on left edge
  const bar = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.7);
  bar.addColorStop(0, accent);
  bar.addColorStop(1, accent2);
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, 8, h);
}

async function composeLiquidChrome(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  accent: string,
  accent2: string,
) {
  const plate = renderMeshPlate(w, h, [accent, accent2, '#a8c0ff', '#ffd4a8'], seedFrom(req.title) + 3);
  ctx.drawImage(await loadImage(plate), 0, 0);

  // Darken center so chrome pops
  const veil = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.55);
  veil.addColorStop(0, 'rgba(0,0,0,0.35)');
  veil.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, w, h);

  if (req.kicker) {
    const k = await renderTextSprite({
      text: req.kicker,
      fontFamily: 'Space Grotesk Medium',
      fontSize: Math.round(h * 0.022),
      tracking: 0.4,
      uppercase: true,
      fill: { kind: 'solid', color: withAlpha(IVORY, 0.65) },
    });
    drawSprite(ctx, k, w / 2, h * 0.32, {});
  }

  const size = fitSize(req.title, 'Space Grotesk Bold', h * 0.16, w * 0.86, -0.03);
  const chrome = await renderTextSprite({
    text: req.title,
    fontFamily: 'Space Grotesk Bold',
    fontSize: size,
    tracking: -0.03,
    uppercase: true,
    fill: liquidChromeFill([accent, '#e8eef8', accent2]),
    bevel: true,
    sheen: true,
  });
  drawSprite(ctx, chrome, w / 2, h * 0.5, {
    softShadow: { blur: size * 0.5, dy: size * 0.1, alpha: 0.7 },
    glow: { color: withAlpha(accent, 0.35), blur: size * 0.35 },
  });

  // Floor reflection — flipped faded copy
  ctx.save();
  ctx.translate(0, h * 0.5 + chrome.height * 0.55);
  ctx.scale(1, -0.55);
  ctx.globalAlpha = 0.22;
  const fade = ctx.createLinearGradient(0, 0, 0, chrome.height);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  // draw reflection then mask with fade via destination-in on offscreen
  const refl = createCanvas(w, chrome.height);
  const rctx = refl.getContext('2d');
  rctx.drawImage(chrome.canvas, (w - chrome.width) / 2, 0);
  rctx.globalCompositeOperation = 'destination-in';
  rctx.fillStyle = fade;
  rctx.fillRect(0, 0, w, chrome.height);
  ctx.drawImage(refl, 0, -chrome.height);
  ctx.restore();

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Inter',
      fontSize: Math.round(h * 0.026),
      fill: { kind: 'solid', color: withAlpha(IVORY, 0.7) },
    });
    drawSprite(ctx, sub, w / 2, h * 0.72, {});
  }
}

async function composeNeonGrid(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  accent: string,
  accent2: string,
) {
  const plate = renderNeonGridPlate(w, h, accent, accent2);
  ctx.drawImage(await loadImage(plate), 0, 0);

  const size = fitSize(req.title, 'Archivo Black', h * 0.14, w * 0.88, 0.02);
  const neon = await renderTextSprite({
    text: req.title,
    fontFamily: 'Archivo Black',
    fontSize: size,
    tracking: 0.02,
    uppercase: true,
    fill: neonFill(accent),
  });
  // Multi-pass glow — outer then inner
  drawSprite(ctx, neon, w / 2, h * 0.36, {
    glow: { color: withAlpha(accent, 0.9), blur: size * 0.55 },
  });
  drawSprite(ctx, neon, w / 2, h * 0.36, {
    glow: { color: withAlpha('#ffffff', 0.8), blur: size * 0.12 },
  });

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Space Grotesk Medium',
      fontSize: Math.round(h * 0.028),
      tracking: 0.35,
      uppercase: true,
      fill: { kind: 'solid', color: accent2 },
    });
    drawSprite(ctx, sub, w / 2, h * 0.36 + size * 0.85, {
      glow: { color: withAlpha(accent2, 0.6), blur: 18 },
    });
  }
}

async function composeDuotone(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  accent: string,
  accent2: string,
  notes: string[],
) {
  const photo = await loadPhoto(req.photoPath, notes);
  const duo = await renderDuotonePhoto(photo, w, h, accent, accent2);
  ctx.drawImage(await loadImage(duo), 0, 0);

  // Soft bottom scrim for legibility
  const scrim = ctx.createLinearGradient(0, h * 0.45, 0, h);
  scrim.addColorStop(0, 'rgba(0,0,0,0)');
  scrim.addColorStop(0.45, 'rgba(0,0,0,0.35)');
  scrim.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, w, h);

  if (req.kicker) {
    const k = await renderTextSprite({
      text: req.kicker,
      fontFamily: 'Space Grotesk Bold',
      fontSize: Math.round(h * 0.02),
      tracking: 0.35,
      uppercase: true,
      fill: { kind: 'solid', color: accent2 },
    });
    drawSprite(ctx, k, w * 0.08, h * 0.68, { align: 'left' });
  }

  const size = fitSize(req.title, 'Space Grotesk Bold', h * 0.11, w * 0.84, -0.02);
  const title = await renderTextSprite({
    text: req.title,
    fontFamily: 'Space Grotesk Bold',
    fontSize: size,
    tracking: -0.02,
    uppercase: true,
    fill: { kind: 'solid', color: IVORY },
  });
  drawSprite(ctx, title, w * 0.08, h * 0.78, {
    align: 'left',
    softShadow: { blur: 20, dy: 4, alpha: 0.55 },
  });

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Inter',
      fontSize: Math.round(h * 0.024),
      fill: { kind: 'solid', color: withAlpha(IVORY, 0.75) },
    });
    drawSprite(ctx, sub, w * 0.08, h * 0.78 + size * 0.75, { align: 'left' });
  }
}

async function composeGlassOverPhoto(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  notes: string[],
) {
  const photo = await loadPhoto(req.photoPath, notes);
  const cover = await sharp(photo).resize(w, h, { fit: 'cover', position: 'attention' }).png().toBuffer();
  ctx.drawImage(await loadImage(cover), 0, 0);

  // Frosted glass panel — blurred crop of the photo region
  const panelW = Math.round(w * 0.42);
  const panelH = Math.round(h * 0.55);
  const panelX = Math.round(w * 0.08);
  const panelY = Math.round(h * 0.22);
  const frosted = await sharp(cover)
    .extract({
      left: Math.max(0, panelX),
      top: Math.max(0, panelY),
      width: Math.min(panelW, w - panelX),
      height: Math.min(panelH, h - panelY),
    })
    .blur(28)
    .modulate({ brightness: 0.85 })
    .png()
    .toBuffer();

  ctx.save();
  roundRect(ctx, panelX, panelY, panelW, panelH, 28);
  ctx.clip();
  ctx.drawImage(await loadImage(frosted), panelX, panelY, panelW, panelH);
  // Glass tint + border
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, panelX + 0.75, panelY + 0.75, panelW - 1.5, panelH - 1.5, 28);
  ctx.stroke();

  // Specular top edge
  const spec = ctx.createLinearGradient(panelX, panelY, panelX, panelY + 40);
  spec.addColorStop(0, 'rgba(255,255,255,0.35)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  roundRect(ctx, panelX, panelY, panelW, panelH, 28);
  ctx.clip();
  ctx.fillStyle = spec;
  ctx.fillRect(panelX, panelY, panelW, 40);
  ctx.restore();

  if (req.kicker) {
    const k = await renderTextSprite({
      text: req.kicker,
      fontFamily: 'Space Grotesk Bold',
      fontSize: 18,
      tracking: 0.3,
      uppercase: true,
      fill: { kind: 'solid', color: withAlpha(IVORY, 0.7) },
    });
    drawSprite(ctx, k, panelX + 40, panelY + 56, { align: 'left' });
  }

  const titleSize = fitSize(req.title, 'Space Grotesk Bold', h * 0.07, panelW - 80, -0.02);
  const words = req.title.split(/\s+/);
  let ty = panelY + panelH * 0.4;
  for (const word of words) {
    const sprite = await renderTextSprite({
      text: word,
      fontFamily: 'Space Grotesk Bold',
      fontSize: titleSize,
      tracking: -0.02,
      uppercase: true,
      fill: { kind: 'solid', color: IVORY },
    });
    drawSprite(ctx, sprite, panelX + 40, ty, { align: 'left' });
    ty += titleSize * 0.95;
  }

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Inter',
      fontSize: 22,
      fill: { kind: 'solid', color: withAlpha(IVORY, 0.7) },
    });
    drawSprite(ctx, sub, panelX + 40, panelY + panelH - 56, { align: 'left' });
  }
}

async function composeDepthStack(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  notes: string[],
) {
  const photo = await loadPhoto(req.photoPath, notes, 'portrait');
  // Background: darkened + blurred plate of the photo
  const bg = await sharp(photo)
    .resize(w, h, { fit: 'cover', position: 'attention' })
    .blur(24)
    .modulate({ brightness: 0.38, saturation: 1.25 })
    .png()
    .toBuffer();
  ctx.drawImage(await loadImage(bg), 0, 0);

  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, w, h);

  // Giant type spanning the frame — will sit mid-depth behind the subject
  const size = fitSize(req.title, 'Space Grotesk Bold', h * 0.24, w * 0.96, -0.05);
  const hero = await renderTextSprite({
    text: req.title,
    fontFamily: 'Space Grotesk Bold',
    fontSize: size,
    tracking: -0.05,
    uppercase: true,
    fill: { kind: 'solid', color: IVORY },
  });
  drawSprite(ctx, hero, w / 2, h * 0.4, {
    softShadow: { blur: size * 0.4, dy: size * 0.06, alpha: 0.6 },
    glow: { color: 'rgba(255,255,255,0.25)', blur: size * 0.2 },
  });

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Inter',
      fontSize: Math.round(h * 0.022),
      tracking: 0.18,
      uppercase: true,
      fill: { kind: 'solid', color: withAlpha(IVORY, 0.75) },
    });
    drawSprite(ctx, sub, w / 2, h * 0.4 + size * 0.7, {});
  }

  // Real ML cutout of the subject layered in front of the type
  const subjectPlate = await sharp(photo)
    .resize(w, h, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer();
  try {
    const { removeBackground } = await import('@imgly/background-removal-node');
    const blob = await removeBackground(
      new Blob([subjectPlate], { type: 'image/png' }),
      {
        model: 'medium',
        output: { format: 'image/png', quality: 0.9 },
      },
    );
    const cutBuf = Buffer.from(await blob.arrayBuffer());
    ctx.drawImage(await loadImage(cutBuf), 0, 0, w, h);
    notes.push('Depth stack: ML subject cutout in front of type (true Z-depth).');
  } catch (err) {
    // Fallback soft mask if the model fails to load
    const mask = await softSubjectMask(w, h, 0.5, 0.55, 0.28, 0.48);
    const cut = await sharp(subjectPlate)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    ctx.drawImage(await loadImage(cut), 0, 0);
    notes.push(`Depth stack fallback soft-mask (${(err as Error).message}).`);
  }
}

async function composeMagazine(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  accent: string,
  notes: string[],
) {
  const photo = await loadPhoto(req.photoPath, notes);
  // Asymmetric crop — photo on right two-thirds
  const cover = await sharp(photo)
    .resize(Math.round(w * 0.68), h, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer();

  // Left ink panel
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(await loadImage(cover), Math.round(w * 0.32), 0);

  // Accent vertical rule
  ctx.fillStyle = accent;
  ctx.fillRect(Math.round(w * 0.32) - 4, 0, 4, h);

  // Masthead
  const mast = await renderTextSprite({
    text: req.kicker ?? 'FRAME',
    fontFamily: 'Space Grotesk Bold',
    fontSize: Math.round(h * 0.035),
    tracking: 0.45,
    uppercase: true,
    fill: { kind: 'solid', color: accent },
  });
  drawSprite(ctx, mast, w * 0.04, h * 0.1, { align: 'left' });

  // Stacked editorial title on left
  const words = req.title.split(/\s+/);
  const size = Math.round(h * (words.length > 3 ? 0.07 : 0.09));
  let y = h * 0.32;
  for (const word of words) {
    const sprite = await renderTextSprite({
      text: word,
      fontFamily: 'DM Serif Display',
      fontSize: size,
      fill: { kind: 'solid', color: IVORY },
    });
    drawSprite(ctx, sprite, w * 0.04, y, { align: 'left' });
    y += size * 1.05;
  }

  if (req.subtitle) {
    const lines = wrapText(req.subtitle, 'Inter', 20, w * 0.24);
    let sy = y + 36;
    for (const line of lines.slice(0, 4)) {
      const s = await renderTextSprite({
        text: line,
        fontFamily: 'Inter',
        fontSize: 18,
        fill: { kind: 'solid', color: withAlpha(IVORY, 0.6) },
      });
      drawSprite(ctx, s, w * 0.04, sy, { align: 'left' });
      sy += 28;
    }
  }

  // Issue number bottom-left
  const issue = await renderTextSprite({
    text: 'VOL. 04',
    fontFamily: 'Space Grotesk Medium',
    fontSize: 14,
    tracking: 0.3,
    uppercase: true,
    fill: { kind: 'solid', color: withAlpha(IVORY, 0.4) },
  });
  drawSprite(ctx, issue, w * 0.04, h * 0.92, { align: 'left' });
}

async function composeBrutalist(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  accent: string,
) {
  ctx.fillStyle = '#f2efe8';
  ctx.fillRect(0, 0, w, h);

  // Hard geometric blocks
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w * 0.08, h);
  ctx.fillStyle = accent;
  ctx.fillRect(w * 0.08, 0, w * 0.02, h);

  // Oversized type that bleeds the frame
  const size = Math.round(h * 0.28);
  const words = req.title.toUpperCase().split(/\s+/);
  let y = h * 0.28;
  for (const word of words.slice(0, 3)) {
    const sprite = await renderTextSprite({
      text: word,
      fontFamily: 'Anton',
      fontSize: size,
      tracking: -0.02,
      fill: { kind: 'solid', color: INK },
    });
    drawSprite(ctx, sprite, w * 0.14, y, { align: 'left' });
    y += size * 0.82;
  }

  // Hairline grid
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = w * 0.14 + ((w * 0.8) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.08);
    ctx.lineTo(x, h * 0.92);
    ctx.stroke();
  }

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle.toUpperCase(),
      fontFamily: 'Space Grotesk Bold',
      fontSize: 22,
      tracking: 0.2,
      fill: { kind: 'solid', color: accent },
    });
    drawSprite(ctx, sub, w * 0.14, h * 0.9, { align: 'left' });
  }
}

async function composeAuroraType(
  ctx: Ctx,
  w: number,
  h: number,
  req: ModernArtefactRequest,
  accent: string,
  accent2: string,
) {
  // Soft dark aurora wash for the backdrop
  const plate = renderMeshPlate(w, h, [accent, accent2, '#5ef0c8', '#7aa2ff'], seedFrom(req.title) + 9);
  const soft = await sharp(plate).blur(50).modulate({ brightness: 0.45 }).png().toBuffer();
  ctx.drawImage(await loadImage(soft), 0, 0);

  // High-contrast fill source — bright unblurred mesh so glyphs read as aurora
  const fillSrc = await sharp(plate)
    .modulate({ brightness: 1.85, saturation: 1.7 })
    .png()
    .toBuffer();

  const size = fitSize(req.title, 'Space Grotesk Bold', h * 0.2, w * 0.92, -0.04);
  const aurora = await renderTextSprite({
    text: req.title,
    fontFamily: 'Space Grotesk Bold',
    fontSize: size,
    tracking: -0.04,
    uppercase: true,
    fill: { kind: 'image', image: fillSrc },
    bevel: true,
    sheen: true,
  });
  drawSprite(ctx, aurora, w / 2, h * 0.5, {
    softShadow: { blur: size * 0.55, dy: size * 0.08, alpha: 0.6 },
    glow: { color: withAlpha(accent2, 0.55), blur: size * 0.45 },
  });

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Inter',
      fontSize: Math.round(h * 0.026),
      tracking: 0.25,
      uppercase: true,
      fill: { kind: 'solid', color: withAlpha(IVORY, 0.65) },
    });
    drawSprite(ctx, sub, w / 2, h * 0.5 + size * 0.85, {});
  }
}

/* ————————————————————————————————————————————————
 * Helpers
 * ———————————————————————————————————————————————— */

async function loadPhoto(
  path: string | undefined,
  notes: string[],
  fallback: 'portrait' | 'landscape' | 'city' = 'landscape',
): Promise<Buffer> {
  const fallbacks: Record<string, string> = {
    portrait: join(process.cwd(), 'assets/photo_portrait.jpg'),
    landscape: join(process.cwd(), 'assets/photo_landscape.jpg'),
    city: join(process.cwd(), 'assets/photo_city.jpg'),
  };
  const resolved = path && existsSync(path) ? path : fallbacks[fallback];
  if (!path) notes.push(`No photoPath — using bundled ${fallback} sample.`);
  else if (!existsSync(path)) notes.push(`photoPath missing, fell back to ${fallback}.`);
  return sharp(resolved).png().toBuffer();
}

function fitSize(
  text: string,
  fontFamily: string,
  ideal: number,
  maxWidth: number,
  tracking: number,
): number {
  const probe = createCanvas(8, 8).getContext('2d');
  let size = Math.round(ideal);
  for (let i = 0; i < 28; i++) {
    probe.font = `${size}px "${fontFamily}", sans-serif`;
    const upper = text.toUpperCase();
    const width =
      probe.measureText(upper).width + tracking * size * Math.max(0, upper.length - 1);
    if (width <= maxWidth || size <= 28) break;
    size = Math.round(size * 0.94);
  }
  return size;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
