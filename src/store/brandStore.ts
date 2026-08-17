import { create } from 'zustand';
import { DEFAULT_BRAND_KIT, type BrandKit } from '../types/document';
import { reportDiagnostic } from '../lib/diagnostics';

const KEY = 'imago-brand-kit-v1';
const LEGACY_KEY = 'pedit-brand-kit';

function persist(brand: BrandKit) {
  try {
    localStorage.setItem(KEY, JSON.stringify(brand));
  } catch (cause) {
    reportDiagnostic('storage', cause);
  }
}

function load(): BrandKit {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw) return { ...DEFAULT_BRAND_KIT, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_BRAND_KIT };
}

interface BrandStore {
  brand: BrandKit;
  setBrand: (patch: Partial<BrandKit>) => void;
  resetBrand: () => void;
}

export const useBrandStore = create<BrandStore>((set, get) => ({
  brand: load(),
  setBrand: (patch) => {
    const brand = { ...get().brand, ...patch };
    persist(brand);
    set({ brand });
  },
  resetBrand: () => {
    persist(DEFAULT_BRAND_KIT);
    set({ brand: { ...DEFAULT_BRAND_KIT } });
  },
}));
