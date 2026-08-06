import { create } from 'zustand';

const KEY = 'pedit-prefs';

interface Prefs {
  lastExportFormat: 'png' | 'jpg';
  lastBgVariant: string;
  beautyDefault: number;
  liquifyPreviewScale: number;
  set: (patch: Partial<Omit<Prefs, 'set'>>) => void;
}

function load(): Omit<Prefs, 'set'> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      return {
        lastExportFormat: 'jpg',
        lastBgVariant: 'panels',
        beautyDefault: 60,
        liquifyPreviewScale: 0.5,
        ...JSON.parse(raw),
      };
    }
  } catch {
    /* ignore */
  }
  return {
    lastExportFormat: 'jpg',
    lastBgVariant: 'panels',
    beautyDefault: 60,
    liquifyPreviewScale: 0.5,
  };
}

export const usePrefsStore = create<Prefs>((set, get) => ({
  ...load(),
  set: (patch) => {
    const next = { ...get(), ...patch };
    const { set: _, ...rest } = next;
    localStorage.setItem(KEY, JSON.stringify(rest));
    set(patch);
  },
}));
