import { createCanvas } from '@napi-rs/canvas';
import type { BackgroundVariant, BrandKit } from './paths.js';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb(r: number, g: number, b: number) {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgb(
    Math.min(255, Math.max(0, r + amount)),
    Math.min(255, Math.max(0, g + amount)),
    Math.min(255, Math.max(0, b + amount)),
  );
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderBackgroundBuffer(
  width: number,
  height: number,
  variant: BackgroundVariant,
  brand: BrandKit,
  seed = Date.now() % 100000,
): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const primary = brand.primary;
  const accent = brand.accent;
  const rng = mulberry32(seed || 1);

  switch (variant) {
    case 'solid':
      ctx.fillStyle = primary;
      ctx.fillRect(0, 0, width, height);
      break;
    case 'split': {
      ctx.fillStyle = primary;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(width * (0.35 + rng() * 0.2), 0);
      ctx.lineTo(width, 0);
      ctx.lineTo(width, height);
      ctx.lineTo(width * (0.45 + rng() * 0.2), height);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'linear': {
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, primary);
      g.addColorStop(0.5, shade(accent, -20));
      g.addColorStop(1, accent);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'radial': {
      const g = ctx.createRadialGradient(
        width * 0.35,
        height * 0.4,
        40,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.8,
      );
      g.addColorStop(0, shade(accent, 40));
      g.addColorStop(0.45, accent);
      g.addColorStop(1, primary);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'panels': {
      ctx.fillStyle = primary;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width * 0.55, height * 0.5);
      ctx.rotate((-18 + rng() * 8) * (Math.PI / 180));
      ctx.fillStyle = accent;
      ctx.fillRect(-width * 0.2, -height, width * 0.45, height * 2);
      ctx.fillStyle = shade(accent, 30);
      ctx.fillRect(width * 0.15, -height, width * 0.12, height * 2);
      ctx.restore();
      ctx.fillStyle = shade(primary, 25);
      ctx.beginPath();
      ctx.arc(width * 0.15, height * 0.2, 120 + rng() * 40, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'wash': {
      const g = ctx.createLinearGradient(0, 0, width, 0);
      g.addColorStop(0, shade(primary, -30));
      g.addColorStop(0.5, primary);
      g.addColorStop(1, shade(accent, -40));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 0.35;
      const g2 = ctx.createRadialGradient(
        width * 0.7,
        height * 0.3,
        10,
        width * 0.7,
        height * 0.3,
        width * 0.5,
      );
      g2.addColorStop(0, accent);
      g2.addColorStop(1, 'transparent');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
      break;
    }
    case 'punch': {
      ctx.fillStyle = shade(primary, -40);
      ctx.fillRect(0, 0, width, height);
      const g = ctx.createRadialGradient(
        width * 0.5,
        height * 0.45,
        20,
        width * 0.5,
        height * 0.5,
        width * 0.7,
      );
      g.addColorStop(0, shade(accent, 60));
      g.addColorStop(0.4, accent);
      g.addColorStop(1, shade(primary, -40));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      break;
    }
  }

  return canvas.toBuffer('image/png');
}
