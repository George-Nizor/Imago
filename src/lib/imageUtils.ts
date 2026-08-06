export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function fitScale(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  mode: 'fit' | 'fill' = 'fit',
): number {
  const sx = canvasW / imgW;
  const sy = canvasH / imgH;
  return mode === 'fit' ? Math.min(sx, sy) : Math.max(sx, sy);
}

export function centerTransform(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  mode: 'fit' | 'fill' = 'fit',
) {
  const scale = fitScale(imgW, imgH, canvasW, canvasH, mode);
  const x = (canvasW - imgW * scale) / 2;
  const y = (canvasH - imgH * scale) / 2;
  return { x, y, scaleX: scale, scaleY: scale, rotation: 0 };
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      type,
      quality,
    );
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Simple CSS filter string from grade settings */
export function gradeToCssFilter(grade: {
  brightness: number;
  contrast: number;
  saturation: number;
}): string {
  const b = 1 + grade.brightness / 100;
  const c = 1 + grade.contrast / 100;
  const s = 1 + grade.saturation / 100;
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}
