import { create } from 'zustand';
import { reportDiagnostic } from '../lib/diagnostics';

const KEY = 'imago-prefs-v1';
const LEGACY_KEY = 'pedit-prefs';

interface Prefs {
  lastExportFormat: 'png' | 'jpg';
  lastBgVariant: string;
  beautyDefault: number;
  liquifyPreviewScale: number;
  set: (patch: Partial<Omit<Prefs, 'set'>>) => void;
}

function load(): Omit<Prefs, 'set'> {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
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
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch (cause) {
      reportDiagnostic('storage', cause);
    }
    set(patch);
  },
}));
