import { createCanvas, GlobalFonts, loadImage, type Canvas } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_ROOT } from './paths.js';

export type TypoStyle =
  | 'editorial'
  | 'film-credits'
  | 'soft-lume'
  | 'knockout'
  | 'image-clip'
  | 'yt-punch'
  | 'ghost-overlap'
  | 'glass';

export type Mood = 'noir' | 'ember' | 'fog' | 'deep-teal' | 'paper';

export const FONT_CATALOG: { id: string; family: string; role: string; fileHint: string }[] = [
  { id: 'archivo', family: 'Archivo Black', role: 'yt-block', fileHint: 'archivo-black' },
  { id: 'bebas', family: 'Bebas Neue', role: 'display-condensed', fileHint: 'bebas-neue' },
  { id: 'anton', family: 'Anton', role: 'yt-block', fileHint: 'anton' },
  { id: 'oswald', family: 'Oswald', role: 'condensed', fileHint: 'oswald' },
  { id: 'playfair', family: 'Playfair Display', role: 'editorial-serif', fileHint: 'playfair-display' },
  { id: 'cinzel', family: 'Cinzel', role: 'title-card', fileHint: 'cinzel' },
  { id: 'space', family: 'Space Grotesk', role: 'modern-sans', fileHint: 'space-grotesk' },
  { id: 'inter', family: 'Inter', role: 'ui-sans', fileHint: 'inter' },
  { id: 'dmserif', family: 'DM Serif Display', role: 'magazine-serif', fileHint: 'dm-serif-display' },
  { id: 'rubik', family: 'Rubik', role: 'soft-sans', fileHint: 'rubik' },
];

let fontsReady = false;

export function ensureFontsRegistered() {
  if (fontsReady) return;
  const fontDir = join(MCP_ROOT, 'fonts');
  const pairs: [string, string][] = [
    ['ArchivoBlack.ttf', 'Archivo Black'],
    ['BebasNeue.ttf', 'Bebas Neue'],
    ['Anton.ttf', 'Anton'],
    ['Oswald.ttf', 'Oswald'],
    ['PlayfairDisplay.ttf', 'Playfair Display'],
    ['Cinzel.ttf', 'Cinzel'],
    ['SpaceGrotesk.ttf', 'Space Grotesk'],
    ['SpaceGroteskMedium.ttf', 'Space Grotesk Medium'],
    ['SpaceGroteskBold.ttf', 'Space Grotesk Bold'],
    ['Inter.ttf', 'Inter'],
    ['InterExtraBold.ttf', 'Inter ExtraBold'],
    ['DMSerifDisplay.ttf', 'DM Serif Display'],
    ['Rubik.ttf', 'Rubik'],
    ['OswaldSemiBold.ttf', 'Oswald SemiBold'],
    ['CinzelSemiBold.ttf', 'Cinzel SemiBold'],
    ['PlayfairDisplayBold.ttf', 'Playfair Display Bold'],
  ];
  for (const [file, family] of pairs) {
    const p = join(fontDir, file);
    if (existsSync(p)) {
      try {
        GlobalFonts.registerFromPath(p, family);
      } catch (e) {
        console.error('font register failed', family, e);
      }
    }
  }
  fontsReady = true;
}

type Ctx2D = ReturnType<Canvas['getContext']>;

function fontString(size: number, family: string, weight = 400) {
  return `${weight} ${size}px "${family}", "Arial Black", sans-serif`;
}

/* ————————————————————————————————————————————————
 * Material fills
 * ———————————————————————————————————————————————— */

export type FillSpec =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; stops: [number, string][] }
  | { kind: 'foil-gold' }
  | { kind: 'foil-silver' }
  | { kind: 'foil-rose' }
  | { kind: 'image'; image: Buffer };

const FOILS: Record<string, [number, string][]> = {
  'foil-gold': [
    [0, '#fbf3d5'],
    [0.28, '#eccf7f'],
    [0.52, '#b98a2e'],
    [0.66, '#f4e2a4'],
    [0.85, '#9a6d20'],
    [1, '#c9a24a'],
  ],
  'foil-silver': [
    [0, '#ffffff'],
    [0.3, '#ccd3dc'],
    [0.52, '#848e9c'],
    [0.68, '#e9edf2'],
    [1, '#9aa4b2'],
  ],
  'foil-rose': [
    [0, '#fce8dc'],
    [0.3, '#e8b49a'],
    [0.55, '#b06a4e'],
    [0.72, '#f2cdb4'],
    [1, '#8e4f38'],
  ],
};

/* ————————————————————————————————————————————————
 * Text sprite: tracked glyphs + material fill + bevel/sheen,
 * rendered offscreen so composites stay contained.
 * ———————————————————————————————————————————————— */

export interface SpriteOpts {
  text: string;
  fontFamily: string;
  fontSize: number;
  /** Letter tracking as a fraction of fontSize (e.g. 0.3 = very airy caps) */
  tracking?: number;
  weight?: number;
  fill?: FillSpec;
  /** Metallic top-light pass */
  bevel?: boolean;
  /** Diagonal sheen band across glyphs */
  sheen?: boolean;
  uppercase?: boolean;
  opacity?: number;
}

export interface TextSprite {
  canvas: Canvas;
  width: number;
  height: number;
  /** Vertical center of the glyph row inside the sprite */
  midY: number;
}

export async function renderTextSprite(opts: SpriteOpts): Promise<TextSprite> {
  ensureFontsRegistered();
  const {
    fontFamily,
    fontSize,
    tracking = 0,
    weight = 400,
    fill = { kind: 'solid', color: '#f2ead8' },
    bevel = false,
    sheen = false,
    uppercase = false,
    opacity = 1,
  } = opts;
  const text = uppercase ? opts.text.toUpperCase() : opts.text;

  const probe = createCanvas(8, 8).getContext('2d');
  probe.font = fontString(fontSize, fontFamily, weight);

  const chars = [...text];
  const trackPx = tracking * fontSize;
  let total = 0;
  const widths = chars.map((c) => {
    const w = probe.measureText(c).width;
    total += w;
    return w;
  });
  total += trackPx * Math.max(0, chars.length - 1);

  const pad = Math.ceil(fontSize * 0.35);
  const w = Math.max(2, Math.ceil(total + pad * 2));
  const h = Math.ceil(fontSize * 1.6 + pad * 2);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const midY = h / 2;

  ctx.font = fontString(fontSize, fontFamily, weight);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';

  let cx = pad;
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, midY);
    cx += widths[i] + trackPx;
  });

  // Material fill
  ctx.globalCompositeOperation = 'source-in';
  const gy0 = midY - fontSize * 0.62;
  const gy1 = midY + fontSize * 0.55;
  if (fill.kind === 'solid') {
    ctx.fillStyle = fill.color;
    ctx.fillRect(0, 0, w, h);
  } else if (fill.kind === 'gradient') {
    const g = ctx.createLinearGradient(0, gy0, 0, gy1);
    for (const [stop, color] of fill.stops) g.addColorStop(stop, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (fill.kind === 'image') {
    const img = await loadImage(fill.image);
    const scale = Math.max(w / img.width, h / img.height);
    ctx.drawImage(img, (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale);
  } else {
    const stops = FOILS[fill.kind];
    const g = ctx.createLinearGradient(0, gy0, 0, gy1);
    for (const [stop, color] of stops) g.addColorStop(stop, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Bevel: bright top-light band inside glyphs
  if (bevel) {
    ctx.globalCompositeOperation = 'source-atop';
    const hl = ctx.createLinearGradient(0, gy0, 0, midY + fontSize * 0.1);
    hl.addColorStop(0, 'rgba(255,255,255,0.55)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, w, h);
    const contact = ctx.createLinearGradient(0, midY + fontSize * 0.25, 0, gy1);
    contact.addColorStop(0, 'rgba(40,20,0,0)');
    contact.addColorStop(1, 'rgba(40,20,0,0.35)');
    ctx.fillStyle = contact;
    ctx.fillRect(0, 0, w, h);
  }

  // Sheen: diagonal light streak
  if (sheen) {
    ctx.globalCompositeOperation = 'source-atop';
    const s = ctx.createLinearGradient(w * 0.15, 0, w * 0.55, h);
    s.addColorStop(0.42, 'rgba(255,255,255,0)');
    s.addColorStop(0.5, 'rgba(255,255,255,0.34)');
    s.addColorStop(0.58, 'rgba(255,255,255,0)');
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.globalCompositeOperation = 'source-over';

  if (opacity < 1) {
    const faded = createCanvas(w, h);
    const fctx = faded.getContext('2d');
    fctx.globalAlpha = opacity;
    fctx.drawImage(canvas, 0, 0);
    return { canvas: faded, width: w, height: h, midY };
  }

  return { canvas, width: w, height: h, midY };
}

export interface DrawSpriteOpts {
  align?: 'left' | 'center' | 'right';
  /** Deep soft ambient shadow (cinematic float) */
  softShadow?: { blur: number; dy: number; alpha: number };
  /** Colored glow behind glyphs */
  glow?: { color: string; blur: number };
}

export function drawSprite(
  ctx: Ctx2D,
  sprite: TextSprite,
  x: number,
  y: number,
  opts: DrawSpriteOpts = {},
) {
  const { align = 'center', softShadow, glow } = opts;
  const dx =
    align === 'left' ? x : align === 'right' ? x - sprite.width : x - sprite.width / 2;
  const dy = y - sprite.midY;

  if (softShadow) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${softShadow.alpha})`;
    ctx.shadowBlur = softShadow.blur;
    ctx.shadowOffsetY = softShadow.dy;
    ctx.drawImage(sprite.canvas, dx, dy);
    ctx.restore();
  }
  if (glow) {
    ctx.save();
    ctx.shadowColor = glow.color;
    ctx.shadowBlur = glow.blur;
    ctx.drawImage(sprite.canvas, dx, dy);
    ctx.restore();
  }
  ctx.drawImage(sprite.canvas, dx, dy);
}

/* ————————————————————————————————————————————————
 * Ornaments
 * ———————————————————————————————————————————————— */

export function drawDiamondDivider(
  ctx: Ctx2D,
  cx: number,
  y: number,
  width: number,
  color = 'rgba(212,166,77,0.85)',
) {
  const half = width / 2;
  const d = 5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - half, y);
  ctx.lineTo(cx - d * 2.4, y);
  ctx.moveTo(cx + d * 2.4, y);
  ctx.lineTo(cx + half, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, y - d);
  ctx.lineTo(cx + d, y);
  ctx.lineTo(cx, y + d);
  ctx.lineTo(cx - d, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawKeylineFrame(
  ctx: Ctx2D,
  width: number,
  height: number,
  inset: number,
  color = 'rgba(226,214,190,0.22)',
  cornerTicks = true,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(inset + 0.5, inset + 0.5, width - inset * 2 - 1, height - inset * 2 - 1);
  if (cornerTicks) {
    const t = 18;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color.replace(/[\d.]+\)$/, '0.6)');
    const corners: [number, number, number, number][] = [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * t, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * t);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Word-wrap text to a max pixel width. */
export function wrapText(
  text: string,
  fontFamily: string,
  fontSize: number,
  maxWidth: number,
  weight = 400,
): string[] {
  const probe = createCanvas(8, 8).getContext('2d');
  probe.font = fontString(fontSize, fontFamily, weight);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (probe.measureText(attempt).width <= maxWidth || !line) {
      line = attempt;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ————————————————————————————————————————————————
 * Cinematic plate v2 — layered: base gradient, off-center glow,
 * aurora wash, bokeh, dust, grain, asymmetric vignette.
 * ———————————————————————————————————————————————— */

interface PlatePalette {
  top: string;
  bottom: string;
  glow: string;
  aurora: string;
  bokeh: string;
}

const PLATES: Record<Mood, PlatePalette> = {
  noir: { top: '#0a0d14', bottom: '#04060a', glow: '#31415e', aurora: '#1a2a48', bokeh: '#a8bedd' },
  ember: { top: '#170b07', bottom: '#080403', glow: '#7c3d18', aurora: '#42160e', bokeh: '#f0a45a' },
  fog: { top: '#12151b', bottom: '#08090d', glow: '#4b555f', aurora: '#242c38', bokeh: '#b9c4d4' },
  'deep-teal': { top: '#071514', bottom: '#020807', glow: '#14584f', aurora: '#0a2e2c', bokeh: '#7fdcc8' },
  paper: { top: '#1c1712', bottom: '#0d0a07', glow: '#6b5434', aurora: '#33271a', bokeh: '#e0c188' },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderCinematicPlate(
  width: number,
  height: number,
  mood: Mood = 'noir',
  seed = 7,
): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const p = PLATES[mood];
  const rng = mulberry32(seed);

  // Base vertical grade
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, p.top);
  base.addColorStop(1, p.bottom);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // Off-center hero glow (where the text will sit)
  const glow = ctx.createRadialGradient(
    width * 0.5,
    height * 0.44,
    30,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.62,
  );
  glow.addColorStop(0, p.glow);
  glow.addColorStop(0.55, `${p.glow}00`.slice(0, 7) + '33');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Aurora washes — two soft color blobs in opposite corners
  for (const [ax, ay, ar] of [
    [0.14, 0.18, 0.55],
    [0.88, 0.78, 0.6],
  ] as const) {
    const a = ctx.createRadialGradient(
      width * ax,
      height * ay,
      10,
      width * ax,
      height * ay,
      Math.max(width, height) * ar,
    );
    a.addColorStop(0, p.aurora);
    a.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, width, height);
  }

  // Bokeh — soft accent orbs, mostly upper region
  ctx.globalCompositeOperation = 'lighter';
  const orbs = 11;
  for (let i = 0; i < orbs; i++) {
    const bx = rng() * width;
    const by = rng() * height * 0.75;
    const br = 18 + rng() * 110;
    const alpha = 0.02 + rng() * 0.055;
    const orb = ctx.createRadialGradient(bx, by, 1, bx, by, br);
    orb.addColorStop(0, p.bokeh);
    orb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dust specks
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 70; i++) {
    const dx = rng() * width;
    const dyy = rng() * height;
    const dr = 0.6 + rng() * 1.6;
    ctx.globalAlpha = 0.04 + rng() * 0.12;
    ctx.fillStyle = p.bokeh;
    ctx.beginPath();
    ctx.arc(dx, dyy, dr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Film grain
  const img = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 13;
    img.data[i] = Math.min(255, Math.max(0, img.data[i] + n));
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] + n));
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  // Asymmetric vignette: heavier at bottom corners
  const v = ctx.createRadialGradient(
    width / 2,
    height * 0.42,
    height * 0.3,
    width / 2,
    height * 0.55,
    height * 1.05,
  );
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, width, height);
  const bottomFade = ctx.createLinearGradient(0, height * 0.7, 0, height);
  bottomFade.addColorStop(0, 'rgba(0,0,0,0)');
  bottomFade.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = bottomFade;
  ctx.fillRect(0, 0, width, height);

  return canvas.toBuffer('image/png');
}

/* ————————————————————————————————————————————————
 * Legacy single-pass API (kept for guided thumbnails)
 * ———————————————————————————————————————————————— */

export interface TypoDrawOpts {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  style: TypoStyle;
  fill?: string;
  align?: 'left' | 'center' | 'right';
  maxWidth?: number;
  clipImage?: Buffer;
  letterSpacing?: number;
}

export async function paintAdvancedTypo(ctx: Ctx2D, opts: TypoDrawOpts) {
  ensureFontsRegistered();
  const {
    text,
    x,
    y,
    fontSize,
    fontFamily,
    style,
    fill = '#f2ebe0',
    align = 'center',
    clipImage,
  } = opts;

  if (style === 'image-clip' && clipImage) {
    const sprite = await renderTextSprite({
      text,
      fontFamily,
      fontSize,
      fill: { kind: 'image', image: clipImage },
    });
    drawSprite(ctx, sprite, x, y, { align, softShadow: { blur: fontSize * 0.2, dy: 6, alpha: 0.5 } });
    return;
  }

  if (style === 'knockout') {
    ctx.save();
    ctx.font = fontString(fontSize, fontFamily);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fillText(text, x, y);
    ctx.restore();
    return;
  }

  if (style === 'film-credits') {
    const sprite = await renderTextSprite({
      text,
      fontFamily,
      fontSize,
      tracking: 0.32,
      uppercase: true,
      fill: { kind: 'solid', color: fill },
    });
    drawSprite(ctx, sprite, x, y, { align });
    return;
  }

  if (style === 'soft-lume') {
    const sprite = await renderTextSprite({
      text,
      fontFamily,
      fontSize,
      tracking: 0.14,
      fill: { kind: 'solid', color: '#fdfaf2' },
    });
    drawSprite(ctx, sprite, x, y, {
      align,
      glow: { color: fill, blur: fontSize * 0.3 },
      softShadow: { blur: fontSize * 0.35, dy: fontSize * 0.06, alpha: 0.55 },
    });
    return;
  }

  if (style === 'editorial' || style === 'ghost-overlap' || style === 'glass') {
    const sprite = await renderTextSprite({
      text,
      fontFamily,
      fontSize,
      fill: { kind: 'solid', color: style === 'glass' ? 'rgba(255,255,255,0.2)' : fill },
    });
    if (style === 'ghost-overlap') {
      ctx.save();
      ctx.globalAlpha = 0.18;
      drawSprite(ctx, sprite, x + fontSize * 0.06, y + fontSize * 0.05, { align });
      ctx.restore();
    }
    drawSprite(ctx, sprite, x, y, {
      align,
      softShadow: { blur: fontSize * 0.12, dy: fontSize * 0.04, alpha: 0.5 },
    });
    return;
  }

  // yt-punch — guide-compliant hard outline block type
  ctx.save();
  ctx.font = fontString(fontSize, fontFamily);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;
  ctx.lineWidth = Math.max(8, fontSize * 0.09);
  ctx.strokeStyle = '#0a0a0a';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Darken + blur a plate for foreground pop */
export async function darkenBlurPlate(png: Buffer, darken = 0.45, blur = 8): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  let img = sharp(png).ensureAlpha();
  if (blur > 0) img = img.blur(blur);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * (1 - darken));
    data[i + 1] = Math.round(data[i + 1] * (1 - darken));
    data[i + 2] = Math.round(data[i + 2] * (1 - darken));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

export function wordCountOk(text: string, max = 4): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length <= max;
}
