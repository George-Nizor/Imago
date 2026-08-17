import { createCanvas, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import {
  ensureFontsRegistered,
  renderCinematicPlate,
  darkenBlurPlate,
  renderTextSprite,
  drawSprite,
  drawDiamondDivider,
  drawKeylineFrame,
  wrapText,
  wordCountOk,
  type TypoStyle,
  type Mood,
  type FillSpec,
} from './typography.js';
import { ensureDirs, loadBrand } from './paths.js';
import { readInputImage, resolveOutputPath, writeOutput } from './safety.js';

export type ArtefactKind =
  | 'intro-card'
  | 'chapter-card'
  | 'lower-third'
  | 'end-slate'
  | 'name-tag'
  | 'quote-card';

export interface ArtefactRequest {
  kind: ArtefactKind;
  title: string;
  subtitle?: string;
  backgroundPath?: string;
  mood?: Mood;
  font?: 'playfair' | 'cinzel' | 'bebas' | 'oswald' | 'archivo' | 'anton';
  style?: TypoStyle;
  blendMode?: 'none' | 'image-clip' | 'knockout';
  /** Hero material: gold foil default for cinematic kinds */
  material?: 'foil-gold' | 'foil-silver' | 'foil-rose' | 'ivory';
  width?: number;
  height?: number;
  transparent?: boolean;
  outputName?: string;
  overwrite?: boolean;
}

const FONT_MAP: Record<string, string> = {
  playfair: 'Playfair Display',
  cinzel: 'Cinzel',
  bebas: 'Bebas Neue',
  oswald: 'Oswald',
  archivo: 'Archivo Black',
  anton: 'Anton',
};

const GOLD = '#d4a64d';
const IVORY = '#f2ead8';
const MUTED = '#b6ab97';

function heroFill(req: ArtefactRequest, plate: Buffer | null): FillSpec {
  if (req.blendMode === 'image-clip' && plate) return { kind: 'image', image: plate };
  switch (req.material) {
    case 'foil-silver':
      return { kind: 'foil-silver' };
    case 'foil-rose':
      return { kind: 'foil-rose' };
    case 'ivory':
      return { kind: 'solid', color: IVORY };
    default:
      return { kind: 'foil-gold' };
  }
}

export async function createVideoArtefact(req: ArtefactRequest): Promise<{
  outputPath: string;
  width: number;
  height: number;
  kind: ArtefactKind;
  notes: string[];
}> {
  ensureDirs();
  ensureFontsRegistered();
  if (req.backgroundPath) await readInputImage(req.backgroundPath);
  const notes: string[] = [];

  const kind = req.kind;
  const width = req.width ?? 1920;
  const height =
    req.height ?? (kind === 'lower-third' ? 400 : kind === 'name-tag' ? 280 : 1080);
  const transparent =
    req.transparent ?? (kind === 'lower-third' || kind === 'name-tag');

  if (!wordCountOk(req.title, kind === 'quote-card' ? 18 : 6)) {
    notes.push('Title is long — consider shortening for on-screen clarity.');
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  let plate: Buffer | null = null;
  if (!transparent) {
    if (req.backgroundPath) {
      plate = await sharp(req.backgroundPath).resize(width, height, { fit: 'cover' }).png().toBuffer();
      if (kind === 'quote-card' || kind === 'chapter-card') {
        plate = await darkenBlurPlate(plate, 0.4, 6);
      }
    } else {
      plate = renderCinematicPlate(width, height, req.mood ?? defaultMood(kind), seedFrom(req.title));
    }
    // With image-clip text, the backdrop must recede so the bright fill pops.
    const bg = req.blendMode === 'image-clip' ? await darkenBlurPlate(plate, 0.5, 0) : plate;
    ctx.drawImage(await loadImage(bg), 0, 0);
  } else if (req.blendMode === 'image-clip') {
    plate = req.backgroundPath
      ? await sharp(req.backgroundPath).resize(width, height, { fit: 'cover' }).png().toBuffer()
      : renderCinematicPlate(width, height, req.mood ?? 'ember', seedFrom(req.title));
  }

  // Image-clip fill must contrast with the backdrop it sits on, otherwise the
  // glyphs camouflage. Brighten + saturate the plate used as the text fill.
  let clipFill: Buffer | null = null;
  if (req.blendMode === 'image-clip' && plate) {
    // Sample the bright center band (skip the vignetted corners), then boost.
    const inset = 0.16;
    clipFill = await sharp(plate)
      .extract({
        left: Math.round(width * inset),
        top: Math.round(height * inset),
        width: Math.round(width * (1 - inset * 2)),
        height: Math.round(height * (1 - inset * 2)),
      })
      .resize(width, height)
      .modulate({ brightness: 2.6, saturation: 1.6 })
      .png()
      .toBuffer();
  }

  const fontFamily = FONT_MAP[req.font ?? defaultFont(kind)] ?? 'Cinzel';

  const fillPlate = clipFill ?? plate;
  switch (kind) {
    case 'intro-card':
      await composeIntro(ctx, width, height, req, fontFamily, fillPlate);
      break;
    case 'chapter-card':
      await composeChapter(ctx, width, height, req, fontFamily, fillPlate);
      break;
    case 'end-slate':
      await composeEndSlate(ctx, width, height, req, fontFamily, fillPlate);
      break;
    case 'quote-card':
      await composeQuote(ctx, width, height, req);
      break;
    case 'lower-third':
      await composeLowerThird(ctx, width, height, req, fontFamily);
      notes.push('Lower-third: transparent PNG for overlay in editors (Premiere/CapCut/etc).');
      break;
    case 'name-tag':
      await composeNameTag(ctx, width, height, req, fontFamily);
      break;
  }

  const ext = transparent ? 'png' : 'jpg';
  const outputPath = resolveOutputPath(req.outputName, `${kind}_${req.title}`, ext, req.overwrite);
  if (transparent) {
    writeOutput(outputPath, canvas.toBuffer('image/png'), req.overwrite);
  } else {
    const jpg = await sharp(canvas.toBuffer('image/png')).jpeg({ quality: 93 }).toBuffer();
    writeOutput(outputPath, jpg, req.overwrite);
  }

  notes.push(`Artefact=${kind}; font=${fontFamily}; transparent=${transparent}`);
  void loadBrand;
  return { outputPath, width, height, kind, notes };
}

/* ————————————————————————————————————————————————
 * Compositions
 * ———————————————————————————————————————————————— */

type Ctx = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

async function composeIntro(
  ctx: Ctx,
  w: number,
  h: number,
  req: ArtefactRequest,
  fontFamily: string,
  plate: Buffer | null,
) {
  drawKeylineFrame(ctx, w, h, 52);

  const heroSize = fitHeroSize(req.title, fontFamily, h * 0.13, w * 0.78, 0.12);
  const cy = h * 0.5;

  // Kicker above hero
  if (req.subtitle) {
    const kicker = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Oswald',
      fontSize: Math.round(h * 0.024),
      tracking: 0.52,
      uppercase: true,
      fill: { kind: 'solid', color: GOLD },
    });
    drawSprite(ctx, kicker, w / 2, cy - heroSize * 0.95, {});
  }

  // Hero — foil with bevel + sheen, deep floating shadow
  const hero = await renderTextSprite({
    text: req.title,
    fontFamily,
    fontSize: heroSize,
    tracking: 0.12,
    uppercase: fontFamily !== 'Playfair Display',
    fill: heroFill(req, plate),
    bevel: req.material !== 'ivory',
    sheen: req.material !== 'ivory',
  });
  drawSprite(ctx, hero, w / 2, cy, {
    softShadow: { blur: heroSize * 0.45, dy: heroSize * 0.09, alpha: 0.65 },
  });

  drawDiamondDivider(ctx, w / 2, cy + heroSize * 0.95, Math.min(w * 0.2, 380));
}

async function composeChapter(
  ctx: Ctx,
  w: number,
  h: number,
  req: ArtefactRequest,
  fontFamily: string,
  plate: Buffer | null,
) {
  // Ghost glyph behind the lockup — roman numeral from subtitle, else first letter
  const numeral =
    req.subtitle?.match(/\b([IVXLCDM]{1,6}|\d{1,3})\b/i)?.[1] ??
    req.title.trim().charAt(0);
  const ghost = await renderTextSprite({
    text: numeral.toUpperCase(),
    fontFamily: 'Playfair Display',
    fontSize: Math.round(h * 0.72),
    fill: { kind: 'solid', color: 'rgba(240,228,200,0.055)' },
  });
  drawSprite(ctx, ghost, w / 2, h * 0.5, {});

  drawKeylineFrame(ctx, w, h, 52);

  const cy = h * 0.5;
  if (req.subtitle) {
    const kicker = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Oswald',
      fontSize: Math.round(h * 0.023),
      tracking: 0.55,
      uppercase: true,
      fill: { kind: 'solid', color: GOLD },
    });
    drawSprite(ctx, kicker, w / 2, cy - h * 0.115, {});
    drawDiamondDivider(ctx, w / 2, cy - h * 0.075, 220, 'rgba(212,166,77,0.5)');
  }

  const heroSize = fitHeroSize(req.title, fontFamily, h * 0.105, w * 0.8, 0.04);
  const hero = await renderTextSprite({
    text: req.title,
    fontFamily,
    fontSize: heroSize,
    tracking: 0.04,
    fill: heroFill(req, plate) ?? { kind: 'solid', color: IVORY },
  });
  drawSprite(ctx, hero, w / 2, cy + heroSize * 0.32, {
    softShadow: { blur: heroSize * 0.3, dy: heroSize * 0.06, alpha: 0.55 },
  });
}

async function composeEndSlate(
  ctx: Ctx,
  w: number,
  h: number,
  req: ArtefactRequest,
  fontFamily: string,
  plate: Buffer | null,
) {
  drawKeylineFrame(ctx, w, h, 52);
  const cy = h * 0.46;

  const heroSize = fitHeroSize(req.title, fontFamily, h * 0.085, w * 0.7, 0.2);
  const hero = await renderTextSprite({
    text: req.title,
    fontFamily,
    fontSize: heroSize,
    tracking: 0.2,
    uppercase: true,
    fill: req.blendMode === 'image-clip' && plate ? { kind: 'image', image: plate } : { kind: 'solid', color: IVORY },
  });
  drawSprite(ctx, hero, w / 2, cy, {
    glow: { color: 'rgba(160,220,205,0.35)', blur: heroSize * 0.4 },
    softShadow: { blur: heroSize * 0.3, dy: heroSize * 0.05, alpha: 0.5 },
  });

  drawDiamondDivider(ctx, w / 2, cy + heroSize * 0.9, 300, 'rgba(226,214,190,0.4)');

  if (req.subtitle) {
    const sub = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Oswald',
      fontSize: Math.round(h * 0.026),
      tracking: 0.42,
      uppercase: true,
      fill: { kind: 'solid', color: MUTED },
    });
    drawSprite(ctx, sub, w / 2, cy + heroSize * 0.9 + h * 0.055, {});
  }
}

async function composeQuote(ctx: Ctx, w: number, h: number, req: ArtefactRequest) {
  drawKeylineFrame(ctx, w, h, 52);

  // Oversized ghost quotation mark
  const mark = await renderTextSprite({
    text: '\u201C',
    fontFamily: 'Playfair Display',
    fontSize: Math.round(h * 0.42),
    fill: { kind: 'solid', color: 'rgba(212,166,77,0.16)' },
  });
  drawSprite(ctx, mark, w / 2, h * 0.21, {});

  const quoteSize = Math.round(h * 0.052);
  const lines = wrapText(req.title, 'Playfair Display', quoteSize, w * 0.62);
  const lineH = quoteSize * 1.5;
  const blockH = lines.length * lineH;
  const startY = h * 0.47 - blockH / 2 + lineH / 2;
  for (let i = 0; i < lines.length; i++) {
    const sprite = await renderTextSprite({
      text: lines[i],
      fontFamily: 'Playfair Display',
      fontSize: quoteSize,
      fill: { kind: 'solid', color: IVORY },
    });
    drawSprite(ctx, sprite, w / 2, startY + i * lineH, {
      softShadow: { blur: quoteSize * 0.25, dy: 3, alpha: 0.5 },
    });
  }

  const dividerY = startY + blockH - lineH / 2 + h * 0.06;
  drawDiamondDivider(ctx, w / 2, dividerY, 240);

  if (req.subtitle) {
    const attr = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Oswald',
      fontSize: Math.round(h * 0.024),
      tracking: 0.4,
      uppercase: true,
      fill: { kind: 'solid', color: GOLD },
    });
    drawSprite(ctx, attr, w / 2, dividerY + h * 0.05, {});
  }
}

async function composeLowerThird(
  ctx: Ctx,
  w: number,
  h: number,
  req: ArtefactRequest,
  fontFamily: string,
) {
  const barX = 80;
  const barW = Math.min(w * 0.46, 900);
  const barH = h * 0.62;
  const barY = h - barH - 20;
  const cut = barH * 0.35; // angled right edge

  // Backdrop: gradient panel with an angled cut, not a flat gray box
  const g = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  g.addColorStop(0, 'rgba(9,9,12,0.92)');
  g.addColorStop(0.82, 'rgba(9,9,12,0.82)');
  g.addColorStop(1, 'rgba(9,9,12,0.45)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(barX, barY);
  ctx.lineTo(barX + barW, barY);
  ctx.lineTo(barX + barW - cut, barY + barH);
  ctx.lineTo(barX, barY + barH);
  ctx.closePath();
  ctx.fill();

  // Gold spine + hairlines
  const spine = ctx.createLinearGradient(0, barY, 0, barY + barH);
  spine.addColorStop(0, '#eccf7f');
  spine.addColorStop(0.5, '#b98a2e');
  spine.addColorStop(1, '#eccf7f');
  ctx.fillStyle = spine;
  ctx.fillRect(barX, barY, 5, barH);
  ctx.fillStyle = 'rgba(212,166,77,0.35)';
  ctx.fillRect(barX + 5, barY, barW * 0.7, 1);
  ctx.fillRect(barX + 5, barY + barH - 1, barW * 0.62, 1);

  const name = await renderTextSprite({
    text: req.title,
    fontFamily,
    fontSize: Math.round(barH * 0.42),
    tracking: 0.06,
    uppercase: true,
    fill: { kind: 'solid', color: IVORY },
  });
  drawSprite(ctx, name, barX + 34, barY + barH * 0.36, {
    align: 'left',
    softShadow: { blur: 12, dy: 3, alpha: 0.5 },
  });

  if (req.subtitle) {
    const role = await renderTextSprite({
      text: req.subtitle,
      fontFamily: 'Oswald',
      fontSize: Math.round(barH * 0.17),
      tracking: 0.4,
      uppercase: true,
      fill: { kind: 'solid', color: GOLD },
    });
    // Small tick before the role line
    ctx.fillStyle = GOLD;
    ctx.fillRect(barX + 34, barY + barH * 0.72 - 1, 22, 2);
    drawSprite(ctx, role, barX + 34 + 34, barY + barH * 0.72, { align: 'left' });
  }
}

async function composeNameTag(
  ctx: Ctx,
  w: number,
  h: number,
  req: ArtefactRequest,
  fontFamily: string,
) {
  await composeLowerThird(ctx, w, h, req, fontFamily);
}

/* ————————————————————————————————————————————————
 * Helpers
 * ———————————————————————————————————————————————— */

function fitHeroSize(
  text: string,
  fontFamily: string,
  idealSize: number,
  maxWidth: number,
  tracking: number,
): number {
  const probe = createCanvas(8, 8).getContext('2d');
  let size = Math.round(idealSize);
  for (let i = 0; i < 24; i++) {
    probe.font = `${size}px "${fontFamily}", sans-serif`;
    const wText = probe.measureText(text.toUpperCase()).width + tracking * size * (text.length - 1);
    if (wText <= maxWidth || size <= 24) break;
    size = Math.round(size * 0.94);
  }
  return size;
}

function seedFrom(text: string): number {
  let s = 0;
  for (const c of text) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return (s % 1000) + 1;
}

function defaultMood(kind: ArtefactKind): Mood {
  switch (kind) {
    case 'intro-card':
      return 'ember';
    case 'chapter-card':
      return 'paper';
    case 'end-slate':
      return 'deep-teal';
    case 'quote-card':
      return 'noir';
    default:
      return 'noir';
  }
}

function defaultFont(kind: ArtefactKind): keyof typeof FONT_MAP {
  switch (kind) {
    case 'lower-third':
    case 'name-tag':
      return 'bebas';
    case 'quote-card':
      return 'playfair';
    case 'chapter-card':
      return 'playfair';
    case 'intro-card':
      return 'cinzel';
    case 'end-slate':
      return 'oswald';
    default:
      return 'playfair';
  }
}
