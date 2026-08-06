import { loadImage, gradeToCssFilter } from './imageUtils';
import type { GradeSettings } from '../types/document';

/** Bake brightness/contrast/saturation into a new image URL for live preview + export consistency */
export async function bakeGrade(src: string, grade: GradeSettings): Promise<string> {
  if (grade.brightness === 0 && grade.contrast === 0 && grade.saturation === 0) {
    return src;
  }
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = gradeToCssFilter(grade);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error('grade bake failed'));
      else resolve(URL.createObjectURL(b));
    }, 'image/png');
  });
}
