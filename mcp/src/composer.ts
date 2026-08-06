import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBackgroundBuffer } from './backgrounds.js';
import {
  type BackgroundVariant,
  type BrandKit,
  type TextEffect,
  EXPORTS_DIR,
  ensureDirs,
  loadBrand,
  slugify,
} from './paths.js';

export interface SupportPlacement {
  path: string;
  layout?: 'left' | 'right' | 'behind' | 'badge';
  removeBackground?: boolean;
}

export interface ThumbnailRequest {
  title: string;
  subjectPath?: string;
  supportImages?: SupportPlacement[];
  background?: BackgroundVariant;
  seed?: number;
  removeSubjectBackground?: boolean;
  outlineSubject?: boolean;
  outputName?: string;
  brand?: Partial<BrandKit>;
  textEffect?: TextEffect;
  openAfter?: boolean;
}

export interface TitleCardRequest {
  title: string;
  subtitle?: string;
  width?: number;
  height?: number;
  outputName?: string;
  brand?: Partial<BrandKit>;
}

async function maybeCutout(inputPath: string, enabled: boolean): Promise<Buffer> {
  const input = await sharp(inputPath).ensureAlpha().png().toBuffer();
  if (!enabled) return input;
  try {
    const { removeBackground } = await import('@imgly/background-removal-node');
    const blob = await removeBackground(input);
    const ab = await blob.arrayBuffer();
    return Buffer.from(ab);
  } catch (err) {
    console.error('Cutout failed, using original:', err);
    return input;
  }
}

async function withOutline(
  png: Buffer,
  outlineWidth: number,
  outlineColor: string,
): Promise<Buffer> {
  if (outlineWidth <= 0) return png;
  const img = await loadImage(png);
  const ow = outlineWidth;
  const canvas = createCanvas(img.width + ow * 2, img.height + ow * 2);
  const ctx = canvas.getContext('2d');

  for (let a = 0; a < 360; a += 8) {
    const rad = (a * Math.PI) / 180;
    ctx.drawImage(img, ow + Math.cos(rad) * ow, ow + Math.sin(rad) * ow);
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = outlineColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(img, ow, ow);
  return canvas.toBuffer('image/png');
}

function fitContain(
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  const s = Math.min(maxW / srcW, maxH / srcH);
  return { w: Math.round(srcW * s), h: Math.round(srcH * s) };
}

function supportBox(
  layout: SupportPlacement['layout'],
  canvasW: number,
  canvasH: number,
): { x: number; y: number; maxW: number; maxH: number } {
  switch (layout) {
    case 'left':
      return { x: 40, y: 80, maxW: canvasW * 0.35, maxH: canvasH * 0.7 };
    case 'right':
      return { x: canvasW * 0.62, y: 80, maxW: canvasW * 0.35, maxH: canvasH * 0.7 };
    case 'badge':
      return { x: canvasW * 0.72, y: canvasH * 0.08, maxW: canvasW * 0.22, maxH: canvasH * 0.28 };
    case 'behind':
    default:
      return { x: canvasW * 0.55, y: 40, maxW: canvasW * 0.5, maxH: canvasH * 0.85 };
  }
}

async function drawStyledText(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  x: number,
  y: number,
  brand: BrandKit,
  fontSize: number,
  effect: TextEffect = 'extrude-3d',
) {
  ctx.font = `${fontSize}px "${brand.fontFamily}", "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const strokeW = brand.textStrokeWidth;

  if (effect === 'extrude-3d' || effect === 'retro') {
    const depth = Math.max(10, Math.round(fontSize * 0.16));
    const rad = (225 * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    ctx.fillStyle = '#1a1208';
    for (let i = depth; i >= 1; i--) {
      ctx.fillText(text, x + dx * i, y + dy * i);
    }
  }

  if (effect === 'stack-shadow') {
    for (let i = 6; i >= 1; i--) {
      ctx.fillStyle = `rgba(0,0,0,${0.12 + i * 0.06})`;
      ctx.fillText(text, x + i * 3, y + i * 3);
    }
  }

  if (effect === 'neon') {
    ctx.shadowColor = '#39f3ff';
    ctx.shadowBlur = fontSize * 0.35;
    ctx.strokeStyle = '#39f3ff';
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    return;
  }

  if (brand.shadowBlur > 0 && effect !== 'neon') {
    ctx.shadowColor = brand.shadowColor;
    ctx.shadowBlur = brand.shadowBlur;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(0,0,0,0.01)';
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  if (effect === 'comic') {
    ctx.lineWidth = strokeW + 12;
    ctx.strokeStyle = '#f4efe4';
    ctx.strokeText(text, x, y);
  }

  if (strokeW > 0 && effect !== 'neon') {
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = brand.textStroke;
    ctx.strokeText(text, x, y);
  }

  if (effect === 'chrome') {
    const g = ctx.createLinearGradient(x, y - fontSize * 0.6, x, y + fontSize * 0.6);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, '#cfd5de');
    g.addColorStop(0.5, '#8b93a1');
    g.addColorStop(0.75, '#e8ebf0');
    g.addColorStop(1, '#6a7280');
    ctx.fillStyle = g;
  } else if (effect === 'gradient' || effect === 'extrude-3d' || effect === 'retro') {
    const g = ctx.createLinearGradient(x, y - fontSize * 0.55, x, y + fontSize * 0.55);
    g.addColorStop(0, '#fff6d8');
    g.addColorStop(0.45, brand.textFill);
    g.addColorStop(1, brand.accent);
    ctx.fillStyle = g;
  } else if (effect === 'comic') {
    ctx.fillStyle = '#ffcc00';
  } else {
    ctx.fillStyle = brand.textFill;
  }
  ctx.fillText(text, x, y);

  if (effect === 'bevel') {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeText(text, x - 1, y - 1);
  }
}

export async function createYouTubeThumbnail(req: ThumbnailRequest): Promise<{
  outputPath: string;
  width: number;
  height: number;
}> {
  ensureDirs();
  const brand = { ...loadBrand(), ...req.brand };
  const width = 1280;
  const height = 720;
  const bgVariant = req.background ?? 'panels';

  const bg = renderBackgroundBuffer(width, height, bgVariant, brand, req.seed);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(await loadImage(bg), 0, 0);

  // Support images first (behind subject typically)
  const supports = req.supportImages ?? [];
  for (const s of supports) {
    const layout = s.layout ?? 'right';
    const buf = await maybeCutout(s.path, s.removeBackground !== false);
    const img = await loadImage(buf);
    const box = supportBox(layout, width, height);
    const size = fitContain(img.width, img.height, box.maxW, box.maxH);
    ctx.drawImage(img, box.x, box.y, size.w, size.h);
  }

  if (req.subjectPath) {
    let buf = await maybeCutout(req.subjectPath, req.removeSubjectBackground !== false);
    if (req.outlineSubject !== false) {
      buf = await withOutline(buf, brand.subjectOutlineWidth, brand.subjectOutlineColor);
    }
    const img = await loadImage(buf);
    const size = fitContain(img.width, img.height, width * 0.55, height * 0.92);
    const x = (width - size.w) / 2 - width * 0.12;
    const y = height - size.h + 10;
    ctx.drawImage(img, x, y, size.w, size.h);
  }

  await drawStyledText(
    ctx,
    req.title,
    width / 2,
    height * 0.82,
    brand,
    brand.titleSize,
    req.textEffect ?? 'extrude-3d',
  );

  const name = slugify(req.outputName ?? req.title);
  const outputPath = join(EXPORTS_DIR, `${name}.jpg`);
  const jpg = await sharp(canvas.toBuffer('image/png')).jpeg({ quality: 92 }).toBuffer();
  writeFileSync(outputPath, jpg);
  return { outputPath, width, height };
}

export async function createTitleCard(req: TitleCardRequest): Promise<{
  outputPath: string;
  width: number;
  height: number;
}> {
  ensureDirs();
  const brand = { ...loadBrand(), ...req.brand };
  const width = req.width ?? 1920;
  const height = req.height ?? 1080;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // transparent — leave clear
  await drawStyledText(
    ctx,
    req.title,
    width / 2,
    height / 2 - (req.subtitle ? 40 : 0),
    brand,
    Math.round(brand.titleSize * 1.2),
    'extrude-3d',
  );
  if (req.subtitle) {
    await drawStyledText(
      ctx,
      req.subtitle,
      width / 2,
      height / 2 + 60,
      brand,
      brand.subtitleSize,
      'yt-bold',
    );
  }
  const name = slugify(req.outputName ?? req.title);
  const outputPath = join(EXPORTS_DIR, `${name}.png`);
  writeFileSync(outputPath, canvas.toBuffer('image/png'));
  return { outputPath, width, height };
}

export async function removeBackgroundFile(
  inputPath: string,
  outputName?: string,
): Promise<string> {
  ensureDirs();
  const buf = await maybeCutout(inputPath, true);
  const name = slugify(outputName ?? 'cutout');
  const outputPath = join(EXPORTS_DIR, `${name}.png`);
  writeFileSync(outputPath, buf);
  return outputPath;
}

// silence unused Image type if tree-shaken
export type { Image };
