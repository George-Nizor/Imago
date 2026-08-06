import { create } from 'zustand';
import { DEFAULT_BRAND_KIT, type BrandKit } from '../types/document';

const KEY = 'pedit-brand-kit';

function load(): BrandKit {
  try {
    const raw = localStorage.getItem(KEY);
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
    localStorage.setItem(KEY, JSON.stringify(brand));
    set({ brand });
  },
  resetBrand: () => {
    localStorage.setItem(KEY, JSON.stringify(DEFAULT_BRAND_KIT));
    set({ brand: { ...DEFAULT_BRAND_KIT } });
  },
}));
