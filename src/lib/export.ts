import type { DocumentState, Layer } from '../types/document';
import { canvasToBlob, downloadBlob, loadImage, gradeToCssFilter } from './imageUtils';
import { paintTextEffect } from './textEffects';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

/** Render a document (or a specific frame's layers) to a canvas. */
export async function renderDocumentToCanvas(
  doc: DocumentState,
  layers?: Layer[],
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d')!;
  const paintLayers = layers ?? doc.layers;

  if (!doc.transparent) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, doc.width, doc.height);
  } else {
    ctx.clearRect(0, 0, doc.width, doc.height);
  }

  for (const layer of paintLayers) {
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

  return canvas;
}

export async function exportDocument(
  doc: DocumentState,
  format: 'png' | 'jpg',
): Promise<void> {
  const canvas = await renderDocumentToCanvas(doc);
  if (format === 'jpg') {
    // Flatten transparency onto black for JPEG
    const flat = document.createElement('canvas');
    flat.width = doc.width;
    flat.height = doc.height;
    const fctx = flat.getContext('2d')!;
    fctx.fillStyle = '#000000';
    fctx.fillRect(0, 0, doc.width, doc.height);
    fctx.drawImage(canvas, 0, 0);
    const blob = await canvasToBlob(flat, 'image/jpeg', 0.92);
    downloadBlob(blob, `${safeName(doc)}.jpg`);
    return;
  }
  const blob = await canvasToBlob(canvas, 'image/png');
  downloadBlob(blob, `${safeName(doc)}.png`);
}

/** Export the frame strip as an animated GIF. */
export async function exportAnimatedGif(doc: DocumentState): Promise<void> {
  const frames = doc.frames.length > 0 ? doc.frames : [{ id: 'f0', layers: doc.layers }];
  const fps = Math.max(1, Math.min(30, doc.fps || 8));
  const delay = Math.round(1000 / fps);
  const gif = GIFEncoder();

  for (let i = 0; i < frames.length; i++) {
    const canvas = await renderDocumentToCanvas(doc, frames[i].layers);
    // GIF needs opaque pixels — composite onto dark (or brand ink)
    const flat = document.createElement('canvas');
    flat.width = doc.width;
    flat.height = doc.height;
    const fctx = flat.getContext('2d')!;
    fctx.fillStyle = doc.transparent ? '#080706' : '#000000';
    fctx.fillRect(0, 0, doc.width, doc.height);
    fctx.drawImage(canvas, 0, 0);
    const { data } = fctx.getImageData(0, 0, doc.width, doc.height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, doc.width, doc.height, {
      palette,
      delay,
      repeat: 0,
    });
  }

  gif.finish();
  const bytes = gif.bytes();
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'image/gif',
  });
  downloadBlob(blob, `${safeName(doc)}.gif`);
}

/** Download each frame as a numbered PNG. */
export async function exportFramePngs(doc: DocumentState): Promise<void> {
  const frames = doc.frames.length > 0 ? doc.frames : [{ id: 'f0', layers: doc.layers }];
  for (let i = 0; i < frames.length; i++) {
    const canvas = await renderDocumentToCanvas(doc, frames[i].layers);
    const blob = await canvasToBlob(canvas, 'image/png');
    const n = String(i + 1).padStart(2, '0');
    downloadBlob(blob, `${safeName(doc)}_f${n}.png`);
    // Brief pause so the browser doesn't coalesce downloads
    await new Promise((r) => setTimeout(r, 120));
  }
}

/** Small preview for the filmstrip thumbnail. */
export async function renderFrameThumbnail(
  doc: DocumentState,
  layers: Layer[],
  maxW = 128,
): Promise<string> {
  const canvas = await renderDocumentToCanvas(doc, layers);
  const scale = maxW / doc.width;
  const thumb = document.createElement('canvas');
  thumb.width = Math.max(1, Math.round(doc.width * scale));
  thumb.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = thumb.getContext('2d')!;
  ctx.fillStyle = '#080706';
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', 0.72);
}

function safeName(doc: DocumentState) {
  return doc.name.replace(/[^\w\-]+/g, '_');
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
