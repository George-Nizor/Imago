import { useEffect } from 'react';
import { ensureCutoutModel } from '../lib/cutout';

/** Lazy-warm the BG-removal model after idle so first cutout is faster. */
export function usePrefetchModels() {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 2000));
    const id = idle(() => {
      ensureCutoutModel().catch(() => {
        /* model loads on first use if prefetch fails */
      });
    });
    return () => {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(id as number);
      }
    };
  }, []);
}
