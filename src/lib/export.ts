import type { DocumentState, Layer } from '../types/document';
import { canvasToBlob, downloadBlob, loadImage, gradeToCssFilter } from './imageUtils';
import { paintTextEffect } from './textEffects';

export async function exportDocument(
  doc: DocumentState,
  format: 'png' | 'jpg',
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d')!;

  if (format === 'jpg' || !doc.transparent) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, doc.width, doc.height);
  }

  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    if (layer.blendMode === 'multiply') {
      ctx.globalCompositeOperation = 'multiply';
    }

    if (layer.type === 'background') {
      const img = await loadImage(layer.src);
      ctx.drawImage(img, 0, 0, doc.width, doc.height);
    } else if (layer.type === 'image') {
      await drawImageLayer(ctx, layer);
    } else if (layer.type === 'text') {
      drawTextLayer(ctx, layer);
    }
    ctx.restore();
  }

  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, mime, format === 'jpg' ? 0.92 : undefined);
  const safe = doc.name.replace(/[^\w\-]+/g, '_');
  downloadBlob(blob, `${safe}.${format}`);
}

async function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { type: 'image' }>,
) {
  const img = await loadImage(layer.src);
  const { x, y, scaleX, scaleY, rotation } = layer.transform;
  const w = layer.naturalWidth * scaleX;
  const h = layer.naturalHeight * scaleY;

  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  if (layer.outline.enabled && layer.outline.width > 0) {
    const ow = layer.outline.width;
    ctx.save();
    ctx.shadowColor = layer.outline.color;
    ctx.shadowBlur = 0;
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ctx.shadowOffsetX = Math.cos(a) * ow;
      ctx.shadowOffsetY = Math.sin(a) * ow;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  ctx.filter = gradeToCssFilter(layer.grade);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.filter = 'none';
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { type: 'text' }>,
) {
  const { x, y, scaleX, scaleY, rotation } = layer.transform;
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scaleX, scaleY);
  paintTextEffect(ctx, layer, 0, 0);
}
