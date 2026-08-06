import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '../..');
export const EXPORTS_DIR = join(ROOT, 'exports');
export const BRAND_PATH = join(ROOT, '.framekit', 'brand-kit.json');
export const PREFS_PATH = join(ROOT, '.framekit', 'prefs.json');

export type BackgroundVariant =
  | 'solid'
  | 'split'
  | 'linear'
  | 'radial'
  | 'panels'
  | 'wash'
  | 'punch';

export interface BrandKit {
  primary: string;
  accent: string;
  textFill: string;
  textStroke: string;
  textStrokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  fontFamily: string;
  fontWeight: number;
  titleSize: number;
  subtitleSize: number;
  subjectOutlineColor: string;
  subjectOutlineWidth: number;
}

export type TextEffect =
  | 'basic'
  | 'yt-bold'
  | 'comic'
  | 'neon'
  | 'chrome'
  | 'gradient'
  | 'extrude-3d'
  | 'bevel'
  | 'stack-shadow'
  | 'retro';

export const DEFAULT_BRAND: BrandKit = {
  primary: '#1c1914',
  accent: '#d4a017',
  textFill: '#f4efe4',
  textStroke: '#0a0908',
  textStrokeWidth: 10,
  shadowColor: 'rgba(0,0,0,0.7)',
  shadowBlur: 16,
  fontFamily: 'Archivo Black',
  fontWeight: 400,
  titleSize: 100,
  subtitleSize: 48,
  subjectOutlineColor: '#f4efe4',
  subjectOutlineWidth: 14,
};

export const BACKGROUND_VARIANTS: BackgroundVariant[] = [
  'solid',
  'split',
  'linear',
  'radial',
  'panels',
  'wash',
  'punch',
];

export function ensureDirs() {
  mkdirSync(EXPORTS_DIR, { recursive: true });
  mkdirSync(dirname(BRAND_PATH), { recursive: true });
}

export function loadBrand(): BrandKit {
  ensureDirs();
  if (!existsSync(BRAND_PATH)) return { ...DEFAULT_BRAND };
  try {
    return { ...DEFAULT_BRAND, ...JSON.parse(readFileSync(BRAND_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_BRAND };
  }
}

export function saveBrand(patch: Partial<BrandKit>): BrandKit {
  const brand = { ...loadBrand(), ...patch };
  ensureDirs();
  writeFileSync(BRAND_PATH, JSON.stringify(brand, null, 2));
  return brand;
}

export function slugify(name: string): string {
  return name.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}
