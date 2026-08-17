import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MCP_ROOT = findMcpRoot(__dirname);
export const ROOT = resolve(process.env.IMAGO_ROOT ?? dirname(MCP_ROOT));
export const DATA_DIR = resolve(process.env.IMAGO_DATA_DIR ?? join(ROOT, '.imago'));
export const EXPORTS_DIR = resolve(process.env.IMAGO_EXPORTS_DIR ?? join(ROOT, 'exports'));
export const DOCUMENTS_DIR = join(DATA_DIR, 'documents');
export const BRAND_PATH = join(DATA_DIR, 'brand-kit.json');
export const PREFS_PATH = join(DATA_DIR, 'prefs.json');
const LEGACY_BRAND_PATH = join(ROOT, '.framekit', 'brand-kit.json');

function findMcpRoot(start: string): string {
  let current = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    const packagePath = join(current, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: unknown };
        if (packageJson.name === 'imago-mcp') return current;
      } catch {
        // Keep walking: a parent package may still identify the MCP root.
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Unable to locate the imago-mcp package root');
}

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
  defaultTextEffect: TextEffect;
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
  | 'retro'
  | 'editorial'
  | 'film-credits'
  | 'soft-lume'
  | 'glass'
  | 'ghost-overlap'
  | 'foil-gold'
  | 'foil-silver';

export const DEFAULT_BRAND: BrandKit = {
  primary: '#18121f',
  accent: '#729488',
  textFill: '#f0ede6',
  textStroke: '#0e0b13',
  textStrokeWidth: 10,
  shadowColor: 'rgba(0,0,0,0.7)',
  shadowBlur: 16,
  fontFamily: 'Archivo Black',
  fontWeight: 400,
  titleSize: 100,
  subtitleSize: 48,
  subjectOutlineColor: '#f0ede6',
  subjectOutlineWidth: 14,
  defaultTextEffect: 'editorial',
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
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(DOCUMENTS_DIR, { recursive: true });
}

export function loadBrand(): BrandKit {
  ensureDirs();
  const source = existsSync(BRAND_PATH)
    ? BRAND_PATH
    : existsSync(LEGACY_BRAND_PATH)
      ? LEGACY_BRAND_PATH
      : null;
  if (!source) return { ...DEFAULT_BRAND };
  try {
    return { ...DEFAULT_BRAND, ...JSON.parse(readFileSync(source, 'utf8')) };
  } catch {
    return { ...DEFAULT_BRAND };
  }
}

export function saveBrand(patch: Partial<BrandKit>): BrandKit {
  const brand = { ...loadBrand(), ...patch };
  ensureDirs();
  writeFileSync(BRAND_PATH, `${JSON.stringify(brand, null, 2)}\n`);
  return brand;
}

export function slugify(name: string): string {
  return name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}
