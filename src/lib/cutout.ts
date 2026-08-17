export type CutoutProgress = (percent: number) => void;
export const CUTOUT_MODEL = 'isnet_quint8' as const;

let removeBackgroundFn:
  | ((input: ImageBitmapSource, onProgress?: CutoutProgress) => Promise<Blob>)
  | null = null;
let loading: Promise<void> | null = null;

export async function ensureCutoutModel(): Promise<void> {
  if (removeBackgroundFn) return;
  if (loading) return loading;
  loading = (async () => {
    const mod = await import('@imgly/background-removal');
    removeBackgroundFn = async (input, onProgress) => {
      const blob = await mod.removeBackground(input, {
        model: CUTOUT_MODEL,
        debug: false,
        progress: (_key, current, total) => {
          if (total > 0) onProgress?.(Math.min(100, Math.round((current / total) * 100)));
        },
        output: { format: 'image/png', quality: 0.9 },
      });
      return blob as Blob;
    };
  })();
  try {
    await loading;
  } catch (error) {
    // A transient preload failure must not poison every later, user-triggered cutout.
    loading = null;
    throw error;
  }
}

export async function removeBackgroundFromSrc(
  src: string,
  onProgress?: CutoutProgress,
): Promise<string> {
  await ensureCutoutModel();
  const res = await fetch(src);
  const blob = await res.blob();
  const out = await removeBackgroundFn!(blob, onProgress);
  return URL.createObjectURL(out);
}

/** Soft / hard erase on alpha channel; returns new object URL */
export async function eraseOnImage(
  src: string,
  strokes: { x: number; y: number; r: number; soft: boolean }[],
  naturalWidth: number,
  naturalHeight: number,
): Promise<string> {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = naturalWidth;
  canvas.height = naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);
  ctx.globalCompositeOperation = 'destination-out';
  for (const s of strokes) {
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
    if (s.soft) {
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.85, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) return reject(new Error('erase failed'));
      resolve(URL.createObjectURL(b));
    }, 'image/png');
  });
}
