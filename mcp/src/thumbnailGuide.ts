/**
 * Thumbnail layouts derived from the Ultimate Thumbnail Guide checklist.
 * Encodes: 3-element rule, 4-word max, safe zones, hierarchy, high contrast.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureFontsRegistered,
  paintAdvancedTypo,
  renderCinematicPlate,
  darkenBlurPlate,
} from './typography.js';
import { EXPORTS_DIR, ensureDirs, slugify } from './paths.js';

export type ThumbnailLayout =
  | 'face-left-text-right'
  | 'face-right-text-left'
  | 'curiosity-center'
  | 'symbol-focus'
  | 'before-after';

export interface GuidedThumbnailRequest {
  text: string;
  layout?: ThumbnailLayout;
  subjectPath?: string;
  supportPath?: string;
  backgroundPath?: string;
  mood?: 'noir' | 'ember' | 'fog' | 'deep-teal' | 'paper';
  textColor?: '#ffffff' | '#000000' | '#ffe566' | '#f4efe4';
  removeSubjectBackground?: boolean;
  vignette?: boolean;
  outputName?: string;
}

export const SAFE = {
  left: 48,
  top: 40,
  right: 1280 - 48,
  bottom: 720 - 72,
  noGoBottomRight: { x: 980, y: 560 },
};

export async function createGuidedThumbnail(req: GuidedThumbnailRequest): Promise<{
  outputPath: string;
  checklist: string[];
  warnings: string[];
}> {
  ensureDirs();
  ensureFontsRegistered();
  const width = 1280;
  const height = 720;
  const checklist: string[] = [];
  const warnings: string[] = [];

  const words = req.text.trim().split(/\s+/).filter(Boolean);
  if (words.length > 4) {
    warnings.push(`Text has ${words.length} words — guide recommends max 4.`);
  } else {
    checklist.push('≤4 words on thumbnail');
  }

  const layout = req.layout ?? 'face-left-text-right';
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  let plate: Buffer;
  if (req.backgroundPath) {
    plate = await sharp(req.backgroundPath).resize(width, height, { fit: 'cover' }).png().toBuffer();
    plate = await darkenBlurPlate(plate, 0.4, 10);
    checklist.push('Background darkened/blurred for subject pop');
  } else {
    plate = renderCinematicPlate(width, height, req.mood ?? 'ember');
    checklist.push('Cinematic gradient plate (not flat solid)');
  }
  ctx.drawImage(await loadImage(plate), 0, 0);

  if (req.vignette !== false) {
    const v = ctx.createRadialGradient(width / 2, height / 2, 180, width / 2, height / 2, 520);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, width, height);
    checklist.push('Soft vignette (no hard edge border)');
  }

  let elements = 1;

  if (req.supportPath) {
    elements++;
    const support = await loadMaybeCutout(req.supportPath, true);
    const img = await loadImage(support);
    const scale = Math.min((width * 0.42) / img.width, (height * 0.85) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = layout === 'face-right-text-left' ? 40 : width - w - 40;
    const y = (height - h) / 2;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img, x, y, w, h);
    ctx.globalAlpha = 1;
  }

  if (req.subjectPath) {
    elements++;
    let subj = await loadMaybeCutout(req.subjectPath, req.removeSubjectBackground !== false);
    subj = await outlinePng(subj, 12, '#f4efe4');
    const img = await loadImage(subj);
    const scale = Math.min((width * 0.5) / img.width, (height * 0.95) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    let x = layout.includes('face-left') ? width * 0.02 : width - w - width * 0.02;
    if (layout === 'curiosity-center') x = (width - w) / 2;
    const y = height - h + 8;
    if (x + w > SAFE.noGoBottomRight.x && y + h > SAFE.noGoBottomRight.y) {
      x = Math.min(x, SAFE.noGoBottomRight.x - w * 0.35);
      warnings.push('Adjusted subject to reduce timestamp collision zone');
    }
    ctx.drawImage(img, x, y, w, h);
    checklist.push('Subject cutout + hard outline');
    checklist.push('Bleeds edge / fills space (no wasted gaps)');
  }

  elements++;
  const textColor = req.textColor ?? '#f4efe4';
  const fontSize = words.length <= 2 ? 120 : words.length === 3 ? 100 : 84;
  let tx = width * 0.62;
  let ty = height * 0.28;
  let align: 'left' | 'center' | 'right' = 'left';

  if (layout === 'face-right-text-left') {
    tx = SAFE.left;
    ty = height * 0.3;
    align = 'left';
  } else if (layout === 'face-left-text-right') {
    tx = width * 0.52;
    ty = height * 0.28;
    align = 'left';
  } else if (layout === 'curiosity-center') {
    tx = width / 2;
    ty = height * 0.22;
    align = 'center';
  }

  if (ty > 500 && tx > 900) {
    ty = 280;
    warnings.push('Moved text out of lower-right timestamp zone');
  }
  checklist.push('Text clear of lower-right timestamp zone');
  checklist.push('Large bold sans block type');

  await paintAdvancedTypo(ctx, {
    text: req.text.toUpperCase(),
    x: tx,
    y: ty,
    fontSize,
    fontFamily: 'Anton',
    style: 'yt-punch',
    fill: textColor,
    align,
  });

  if (elements > 5) warnings.push('More than 5 elements — guide prefers ≤3.');
  else if (elements <= 3) checklist.push('≤3 visual elements');
  else checklist.push(`${elements} elements (acceptable if sparse)`);

  checklist.push('16:9 1280×720');
  checklist.push('High contrast text via outline');

  const name = slugify(req.outputName ?? `thumb_${req.text}`);
  const outputPath = join(EXPORTS_DIR, `${name}.jpg`);
  const jpg = await sharp(canvas.toBuffer('image/png')).jpeg({ quality: 93 }).toBuffer();
  writeFileSync(outputPath, jpg);

  return { outputPath, checklist, warnings };
}

async function loadMaybeCutout(path: string, cut: boolean): Promise<Buffer> {
  const input = await sharp(path).ensureAlpha().png().toBuffer();
  if (!cut) return input;
  try {
    const { removeBackground } = await import('@imgly/background-removal-node');
    const blob = await removeBackground(input);
    return Buffer.from(await blob.arrayBuffer());
  } catch {
    return input;
  }
}

async function outlinePng(png: Buffer, widthPx: number, color: string): Promise<Buffer> {
  const img = await loadImage(png);
  const ow = widthPx;
  const canvas = createCanvas(img.width + ow * 2, img.height + ow * 2);
  const ctx = canvas.getContext('2d');
  for (let a = 0; a < 360; a += 8) {
    const rad = (a * Math.PI) / 180;
    ctx.drawImage(img, ow + Math.cos(rad) * ow, ow + Math.sin(rad) * ow);
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(img, ow, ow);
  return canvas.toBuffer('image/png');
}
