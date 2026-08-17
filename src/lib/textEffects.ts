import type { TextEffect, TextLayer } from '../types/document';
import { fitTitleFontSize } from './templates.js';

export const TEXT_EFFECT_PRESETS: {
  id: TextEffect;
  label: string;
  hint: string;
}[] = [
  { id: 'foil-gold', label: 'Gold Foil', hint: 'Metallic gold + top light' },
  { id: 'foil-silver', label: 'Silver Foil', hint: 'Cold metallic sheen' },
  { id: 'editorial', label: 'Editorial', hint: 'Clean cinematic serif feel' },
  { id: 'soft-lume', label: 'Soft Lume', hint: 'Gentle glow, film title' },
  { id: 'film-credits', label: 'Credits', hint: 'Spaced caps + rule' },
  { id: 'glass', label: 'Glass', hint: 'Frosted stroke' },
  { id: 'ghost-overlap', label: 'Ghost', hint: 'Offset echo' },
  { id: 'yt-bold', label: 'YT Bold', hint: 'Guide-compliant punch' },
  { id: 'basic', label: 'Basic', hint: 'Clean fill' },
  { id: 'extrude-3d', label: '3D Extrude', hint: 'Block depth' },
  { id: 'chrome', label: 'Chrome', hint: 'Metallic sheen' },
  { id: 'neon', label: 'Neon', hint: 'Glow tube' },
  { id: 'gradient', label: 'Gradient', hint: 'Two-tone fill' },
  { id: 'comic', label: 'Comic', hint: 'Double outline' },
  { id: 'bevel', label: 'Bevel', hint: 'Raised edge' },
  { id: 'stack-shadow', label: 'Stack', hint: 'Hard offset layers' },
  { id: 'retro', label: 'Retro', hint: '70s inline + shade' },
];

type TextDraw = Pick<
  TextLayer,
  | 'text'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'shadowColor'
  | 'shadowBlur'
  | 'shadowOffsetX'
  | 'shadowOffsetY'
  | 'align'
  | 'effect'
  | 'extrudeDepth'
  | 'extrudeAngle'
  | 'extrudeColor'
  | 'gradientFrom'
  | 'gradientTo'
  | 'outerStroke'
  | 'outerStrokeWidth'
  | 'letterSpacing'
  | 'skewX'
  | 'slot'
>;

function effectiveTextLayer(ctx: CanvasRenderingContext2D, layer: TextDraw): TextDraw {
  if (layer.slot?.kind !== 'title' || !layer.slot.canvasWidth) return layer;
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
  const measuredWidth = ctx.measureText(layer.text || ' ').width;
  const fontSize = fitTitleFontSize(
    layer.fontSize,
    layer.slot.box.width * layer.slot.canvasWidth * 0.96,
    measuredWidth,
  );
  if (fontSize >= layer.fontSize) return layer;
  const ratio = fontSize / layer.fontSize;
  return {
    ...layer,
    fontSize,
    strokeWidth: layer.strokeWidth * ratio,
    shadowBlur: layer.shadowBlur * ratio,
    shadowOffsetX: layer.shadowOffsetX * ratio,
    shadowOffsetY: layer.shadowOffsetY * ratio,
    extrudeDepth: layer.extrudeDepth * ratio,
    outerStrokeWidth: layer.outerStrokeWidth * ratio,
    letterSpacing: layer.letterSpacing * ratio,
  };
}

function setupFont(ctx: CanvasRenderingContext2D, layer: TextDraw) {
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${layer.letterSpacing || 0}px`;
  }
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
}

function foilGradient(
  ctx: CanvasRenderingContext2D,
  layer: TextDraw,
  x: number,
  y: number,
  kind: 'foil-gold' | 'foil-silver',
) {
  const g = ctx.createLinearGradient(x, y - layer.fontSize * 0.6, x, y + layer.fontSize * 0.55);
  const stops: [number, string][] =
    kind === 'foil-gold'
      ? [
          [0, '#fbf3d5'],
          [0.28, '#eccf7f'],
          [0.52, '#b98a2e'],
          [0.66, '#f4e2a4'],
          [0.85, '#9a6d20'],
          [1, '#c9a24a'],
        ]
      : [
          [0, '#ffffff'],
          [0.3, '#ccd3dc'],
          [0.52, '#848e9c'],
          [0.68, '#e9edf2'],
          [1, '#9aa4b2'],
        ];
  for (const [stop, color] of stops) g.addColorStop(stop, color);
  return g;
}

function measure(ctx: CanvasRenderingContext2D, layer: TextDraw) {
  const effective = effectiveTextLayer(ctx, layer);
  setupFont(ctx, effective);
  const metrics = ctx.measureText(effective.text || ' ');
  const w = Math.max(metrics.width, effective.fontSize * 0.5);
  const h = effective.fontSize * 1.35;
  const pad =
    Math.max(
      effective.strokeWidth,
      effective.outerStrokeWidth,
      effective.extrudeDepth,
      effective.shadowBlur,
      24,
    ) + 20;
  return { w, h, pad };
}

function fillGradient(
  ctx: CanvasRenderingContext2D,
  layer: TextDraw,
  x: number,
  y: number,
) {
  const g = ctx.createLinearGradient(x, y - layer.fontSize * 0.55, x, y + layer.fontSize * 0.55);
  g.addColorStop(0, layer.gradientFrom);
  g.addColorStop(0.45, layer.fill);
  g.addColorStop(1, layer.gradientTo);
  return g;
}

function chromeGradient(
  ctx: CanvasRenderingContext2D,
  layer: TextDraw,
  x: number,
  y: number,
) {
  const g = ctx.createLinearGradient(x, y - layer.fontSize * 0.6, x, y + layer.fontSize * 0.6);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.22, '#cfd5de');
  g.addColorStop(0.45, '#8b93a1');
  g.addColorStop(0.55, '#e8ebf0');
  g.addColorStop(0.78, '#6a7280');
  g.addColorStop(1, '#d7dbe3');
  return g;
}

function drawExtrusion(ctx: CanvasRenderingContext2D, layer: TextDraw, x: number, y: number) {
  const depth = Math.max(0, Math.round(layer.extrudeDepth));
  if (depth <= 0) return;
  const rad = (layer.extrudeAngle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  ctx.save();
  ctx.fillStyle = layer.extrudeColor;
  ctx.strokeStyle = layer.extrudeColor;
  ctx.lineWidth = Math.max(1, layer.strokeWidth * 0.35);
  for (let i = depth; i >= 1; i--) {
    const px = x + dx * i;
    const py = y + dy * i;
    if (layer.strokeWidth > 0) ctx.strokeText(layer.text, px, py);
    ctx.fillText(layer.text, px, py);
  }
  ctx.restore();
}

function drawStackShadow(ctx: CanvasRenderingContext2D, layer: TextDraw, x: number, y: number) {
  const steps = 6;
  ctx.save();
  for (let i = steps; i >= 1; i--) {
    ctx.fillStyle = `rgba(0,0,0,${0.12 + i * 0.06})`;
    ctx.fillText(layer.text, x + i * 3, y + i * 3);
  }
  ctx.restore();
}

/** Draw styled text at (x,y) into an existing context (export path). */
export function paintTextEffect(
  ctx: CanvasRenderingContext2D,
  layer: TextDraw,
  x = 0,
  y = 0,
) {
  layer = effectiveTextLayer(ctx, layer);
  setupFont(ctx, layer);
  ctx.save();
  if (layer.skewX) {
    ctx.transform(1, 0, layer.skewX, 1, 0, 0);
  }

  const effect = layer.effect || 'basic';

  if (effect === 'extrude-3d') {
    drawExtrusion(ctx, layer, x, y);
  } else if (effect === 'stack-shadow') {
    drawStackShadow(ctx, layer, x, y);
  } else if (effect === 'retro') {
    ctx.save();
    ctx.fillStyle = layer.extrudeColor;
    ctx.fillText(layer.text, x + 6, y + 8);
    ctx.restore();
  }

  // Soft drop for most styles
  if (effect !== 'neon' && layer.shadowBlur > 0) {
    ctx.save();
    ctx.shadowColor = layer.shadowColor;
    ctx.shadowBlur = layer.shadowBlur;
    ctx.shadowOffsetX = layer.shadowOffsetX;
    ctx.shadowOffsetY = layer.shadowOffsetY;
    ctx.fillStyle = 'rgba(0,0,0,0.01)';
    ctx.fillText(layer.text, x, y);
    ctx.restore();
  }

  if (effect === 'comic' && layer.outerStrokeWidth > 0) {
    ctx.lineWidth = layer.strokeWidth + layer.outerStrokeWidth * 2;
    ctx.strokeStyle = layer.outerStroke;
    ctx.strokeText(layer.text, x, y);
  }

  if (effect === 'yt-bold' || effect === 'comic' || effect === 'retro' || effect === 'basic') {
    if (layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.stroke;
      ctx.strokeText(layer.text, x, y);
    }
  }

  if (effect === 'editorial' || effect === 'ghost-overlap') {
    if (effect === 'ghost-overlap') {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = layer.fill;
      ctx.fillText(layer.text, x + layer.fontSize * 0.06, y + layer.fontSize * 0.04);
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = layer.fontSize * 0.08;
    ctx.shadowOffsetY = layer.fontSize * 0.03;
    ctx.fillStyle = layer.fill;
    ctx.fillText(layer.text, x, y);
    ctx.restore();
    ctx.restore();
    return;
  }

  if (effect === 'soft-lume') {
    ctx.save();
    ctx.shadowColor = layer.fill;
    ctx.shadowBlur = layer.fontSize * 0.22;
    ctx.fillStyle = '#fff';
    ctx.fillText(layer.text, x, y);
    ctx.shadowBlur = layer.fontSize * 0.08;
    ctx.fillStyle = layer.fill;
    ctx.fillText(layer.text, x, y);
    ctx.restore();
    ctx.restore();
    return;
  }

  if (effect === 'film-credits') {
    ctx.fillStyle = layer.fill;
    ctx.fillText(layer.text.toUpperCase(), x, y);
    const w = ctx.measureText(layer.text.toUpperCase()).width;
    ctx.strokeStyle = 'rgba(242,235,224,0.35)';
    ctx.lineWidth = 1;
    const left = layer.align === 'center' ? x - w / 2 : layer.align === 'right' ? x - w : x;
    ctx.beginPath();
    ctx.moveTo(left, y + layer.fontSize * 0.55);
    ctx.lineTo(left + w, y + layer.fontSize * 0.55);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (effect === 'glass') {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillText(layer.text, x, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1.5, layer.fontSize * 0.015);
    ctx.strokeText(layer.text, x, y);
    ctx.restore();
    return;
  }

  if (effect === 'neon') {
    ctx.shadowColor = layer.fill;
    ctx.shadowBlur = layer.fontSize * 0.35;
    ctx.strokeStyle = layer.fill;
    ctx.lineWidth = Math.max(2, layer.strokeWidth * 0.4);
    ctx.strokeText(layer.text, x, y);
    ctx.shadowBlur = layer.fontSize * 0.15;
    ctx.fillStyle = '#fff';
    ctx.fillText(layer.text, x, y);
    ctx.shadowBlur = 0;
    ctx.restore();
    return;
  }

  if (effect === 'foil-gold' || effect === 'foil-silver') {
    // Deep floating shadow, metallic fill, top-light highlight edge
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = layer.fontSize * 0.3;
    ctx.shadowOffsetY = layer.fontSize * 0.06;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(layer.text, x, y);
    ctx.restore();
    ctx.fillStyle = foilGradient(ctx, layer, x, y, effect);
    ctx.fillText(layer.text, x, y);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = Math.max(1.5, layer.fontSize * 0.012);
    ctx.strokeText(layer.text, x, y - layer.fontSize * 0.015);
    ctx.restore();
    ctx.restore();
    return;
  }

  if (effect === 'chrome') {
    if (layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.stroke;
      ctx.strokeText(layer.text, x, y);
    }
    ctx.fillStyle = chromeGradient(ctx, layer, x, y);
    ctx.fillText(layer.text, x, y);
    // highlight edge
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeText(layer.text, x, y - 1);
    ctx.restore();
    ctx.restore();
    return;
  }

  if (effect === 'gradient' || effect === 'extrude-3d') {
    if (layer.strokeWidth > 0 && effect === 'gradient') {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.stroke;
      ctx.strokeText(layer.text, x, y);
    }
    if (effect === 'extrude-3d' && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.stroke;
      ctx.strokeText(layer.text, x, y);
    }
    ctx.fillStyle = fillGradient(ctx, layer, x, y);
    ctx.fillText(layer.text, x, y);
    ctx.restore();
    return;
  }

  if (effect === 'bevel') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(2, layer.strokeWidth * 0.35);
    ctx.strokeText(layer.text, x - 1, y - 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(layer.text, x + 1, y + 1);
    ctx.restore();
    if (layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.stroke;
      ctx.strokeText(layer.text, x, y);
    }
    ctx.fillStyle = layer.fill;
    ctx.fillText(layer.text, x, y);
    ctx.restore();
    return;
  }

  if (effect === 'retro') {
    ctx.lineWidth = layer.strokeWidth;
    ctx.strokeStyle = layer.stroke;
    ctx.strokeText(layer.text, x, y);
    ctx.fillStyle = fillGradient(ctx, layer, x, y);
    ctx.fillText(layer.text, x, y);
    ctx.lineWidth = Math.max(2, layer.strokeWidth * 0.25);
    ctx.strokeStyle = layer.outerStroke;
    ctx.strokeText(layer.text, x, y);
    ctx.restore();
    return;
  }

  // basic / yt-bold / comic face
  ctx.fillStyle = layer.fill;
  ctx.fillText(layer.text, x, y);
  ctx.restore();
}

/**
 * Rasterize a text layer to a canvas sized to its content (for Konva Image preview).
 * Returns canvas + anchor offset so the visual center matches transform x,y.
 */
export function rasterizeTextLayer(layer: TextDraw): {
  canvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
} {
  const probe = document.createElement('canvas');
  const pctx = probe.getContext('2d')!;
  const { w, h, pad } = measure(pctx, layer);
  const depth = layer.effect === 'extrude-3d' ? layer.extrudeDepth : 0;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w + pad * 2 + depth);
  canvas.height = Math.ceil(h + pad * 2 + depth);
  const ctx = canvas.getContext('2d')!;

  const originX =
    layer.align === 'left'
      ? pad
      : layer.align === 'right'
        ? canvas.width - pad
        : canvas.width / 2;
  const originY = canvas.height / 2;

  paintTextEffect(ctx, layer, originX, originY);

  return {
    canvas,
    offsetX: originX,
    offsetY: originY,
  };
}

export function applyTextPreset(effect: TextEffect, layer: TextLayer): Partial<TextLayer> {
  switch (effect) {
    case 'basic':
      return {
        effect,
        strokeWidth: 0,
        shadowBlur: 0,
        extrudeDepth: 0,
        skewX: 0,
      };
    case 'yt-bold':
      return {
        effect,
        strokeWidth: Math.max(8, Math.round(layer.fontSize * 0.1)),
        stroke: '#0e0b13',
        fill: '#f0ede6',
        shadowBlur: 14,
        shadowOffsetX: 4,
        shadowOffsetY: 6,
        extrudeDepth: 0,
        skewX: 0,
      };
    case 'comic':
      return {
        effect,
        strokeWidth: Math.max(6, Math.round(layer.fontSize * 0.08)),
        stroke: '#0e0b13',
        outerStroke: '#f0ede6',
        outerStrokeWidth: Math.max(4, Math.round(layer.fontSize * 0.05)),
        fill: '#ffcc00',
        shadowBlur: 0,
        extrudeDepth: 0,
      };
    case 'neon':
      return {
        effect,
        fill: '#39f3ff',
        stroke: '#39f3ff',
        strokeWidth: 2,
        shadowBlur: 24,
        extrudeDepth: 0,
      };
    case 'chrome':
      return {
        effect,
        stroke: '#1a1c22',
        strokeWidth: Math.max(4, Math.round(layer.fontSize * 0.05)),
        fill: '#cfd5de',
        shadowBlur: 10,
        extrudeDepth: 0,
      };
    case 'gradient':
      return {
        effect,
        gradientFrom: '#fff6d8',
        gradientTo: '#729488',
        fill: '#ffe08a',
        stroke: '#1a1208',
        strokeWidth: Math.max(6, Math.round(layer.fontSize * 0.07)),
        shadowBlur: 12,
      };
    case 'extrude-3d':
      return {
        effect,
        extrudeDepth: Math.max(10, Math.round(layer.fontSize * 0.16)),
        extrudeAngle: 225,
        extrudeColor: '#1a1208',
        gradientFrom: '#fff8e8',
        gradientTo: '#e0a800',
        fill: '#ffe566',
        stroke: '#0e0b13',
        strokeWidth: Math.max(5, Math.round(layer.fontSize * 0.06)),
        shadowBlur: 8,
        skewX: -0.12,
      };
    case 'bevel':
      return {
        effect,
        fill: '#e8e4dc',
        stroke: '#2a261e',
        strokeWidth: Math.max(4, Math.round(layer.fontSize * 0.05)),
        shadowBlur: 6,
        extrudeDepth: 0,
      };
    case 'stack-shadow':
      return {
        effect,
        fill: '#f0ede6',
        stroke: '#0e0b13',
        strokeWidth: Math.max(4, Math.round(layer.fontSize * 0.05)),
        shadowBlur: 0,
        extrudeDepth: 0,
      };
    case 'retro':
      return {
        effect,
        fill: '#ff6b35',
        gradientFrom: '#ffd23f',
        gradientTo: '#ff6b35',
        stroke: '#2b0f0a',
        strokeWidth: Math.max(7, Math.round(layer.fontSize * 0.08)),
        outerStroke: '#fff3c4',
        outerStrokeWidth: 3,
        extrudeColor: '#5c1a0a',
        shadowBlur: 0,
      };
    case 'editorial':
      return {
        effect,
        fill: '#f2ebe0',
        strokeWidth: 0,
        shadowBlur: 12,
        extrudeDepth: 0,
        fontFamily: '"Playfair Display", Georgia, serif',
      };
    case 'soft-lume':
      return {
        effect,
        fill: '#f0ede6',
        strokeWidth: 0,
        shadowBlur: 28,
        fontFamily: '"Cinzel", Georgia, serif',
      };
    case 'film-credits':
      return {
        effect,
        fill: '#b89c67',
        strokeWidth: 0,
        shadowBlur: 0,
        fontFamily: '"Oswald", sans-serif',
        letterSpacing: 8,
      };
    case 'glass':
      return {
        effect,
        fill: '#ffffff',
        strokeWidth: 2,
        stroke: '#ffffff',
        shadowBlur: 0,
      };
    case 'ghost-overlap':
      return {
        effect,
        fill: '#f0ede6',
        strokeWidth: 0,
        shadowBlur: 0,
        fontFamily: '"Bebas Neue", sans-serif',
      };
    case 'foil-gold':
      return {
        effect,
        fill: '#eccf7f',
        strokeWidth: 0,
        shadowBlur: 0,
        extrudeDepth: 0,
        fontFamily: '"Cinzel", Georgia, serif',
        letterSpacing: Math.round(layer.fontSize * 0.12),
      };
    case 'foil-silver':
      return {
        effect,
        fill: '#ccd3dc',
        strokeWidth: 0,
        shadowBlur: 0,
        extrudeDepth: 0,
        fontFamily: '"Cinzel", Georgia, serif',
        letterSpacing: Math.round(layer.fontSize * 0.14),
      };
    default:
      return { effect };
  }
}
