import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/index.js";
import type { Series } from "../api/types.js";
import { errorText } from "../lib.js";

// ---- toasts: a short message, optionally with one action (Undo) ----
export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
export type Notify = (text: string, action?: Toast["action"], ms?: number) => void;
export const ToastContext = createContext<Notify>(() => {});
export const useToast = () => useContext(ToastContext);

// ---- series ----
export function useSeries(): { series: Series[]; refresh: () => Promise<Series[]> } {
  const [series, setSeries] = useState<Series[]>([]);
  const refresh = useCallback(async () => {
    const list = await api.listSeries().catch(() => null);
    if (list) setSeries(list);
    return list ?? [];
  }, []);
  useEffect(() => {
    let live = true;
    api.listSeries().then((list) => live && setSeries(list), () => {});
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => ({ series, refresh }), [series, refresh]);
}

// ---- actions shared by the library, the start page and the workspace ----
export function downloadZip(ids: string[]) {
  const a = document.createElement("a");
  a.href = api.exportZipUrl(ids);
  a.download = "imago-export.zip";
  document.body.append(a);
  a.click();
  a.remove();
}

/** Deletes with a toast that undoes it (the server moves the folders to its trash for a week). */
export function useDeleteWithUndo() {
  const toast = useToast();
  return useCallback(
    async (ids: string[], then: (undone: boolean) => void, label?: string) => {
      await api.bulk("delete", ids);
      then(false);
      toast(
        ids.length === 1 ? `Deleted ${label ? `"${label}"` : "the design"}.` : `Deleted ${ids.length} designs.`,
        {
          label: "Undo",
          run: () =>
            api.bulk("restore", ids).then(() => then(true)).catch((e) => toast(errorText(e))),
        },
      );
    },
    [toast],
  );
}

