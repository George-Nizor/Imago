import type { BackgroundVariantKind, BrandKit } from '../types/document';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
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

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
}

export const BACKGROUND_VARIANTS: { id: BackgroundVariantKind; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'split', label: 'Split' },
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
  { id: 'panels', label: 'Panels' },
  { id: 'wash', label: 'Wash' },
  { id: 'punch', label: 'Punch' },
];

export function renderBackground(
  width: number,
  height: number,
  variant: BackgroundVariantKind,
  primary: string,
  accent: string,
  seed = 0,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(seed || 1);

  switch (variant) {
    case 'solid': {
      ctx.fillStyle = primary;
      ctx.fillRect(0, 0, width, height);
      break;
    }
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
      const g2 = ctx.createRadialGradient(width * 0.7, height * 0.3, 10, width * 0.7, height * 0.3, width * 0.5);
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
      const g = ctx.createRadialGradient(width * 0.5, height * 0.45, 20, width * 0.5, height * 0.5, width * 0.7);
      g.addColorStop(0, shade(accent, 60));
      g.addColorStop(0.4, accent);
      g.addColorStop(1, shade(primary, -40));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.15;
      ctx.fillRect(0, 0, width, height * 0.35);
      ctx.restore();
      break;
    }
  }

  // subtle noise texture
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  noise(ctx, width, height, 18);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nextSeed(seed: number) {
  return (seed * 1103515245 + 12345) & 0x7fffffff;
}

export function brandColors(kit: BrandKit) {
  return { primary: kit.primary, accent: kit.accent };
}
