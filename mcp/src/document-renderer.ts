import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import type { DocumentState, ImageLayer, Layer, TextLayer } from '../../src/types/document.js';
import { paintTextEffect } from '../../src/lib/textEffects.js';
import { ensureFontsRegistered } from './typography.js';
import { applyGradeBuffer } from './document-model.js';
import {
  ImagoInputError,
  decodeImageDataUrl,
  resolveOutputPath,
  writeOutput,
} from './safety.js';

const MAX_STILL_PIXELS = 40_000_000;
const MAX_ANIMATION_PIXELS = 80_000_000;
const require = createRequire(import.meta.url);
const { GIFEncoder, applyPalette, quantize } = require('gifenc') as typeof import('gifenc');

export async function renderDocument(
  document: DocumentState,
  layers = document.layers,
  outputSize?: { width: number; height: number },
): Promise<Canvas> {
  const width = outputSize?.width ?? document.width;
  const height = outputSize?.height ?? document.height;
  if (width * height > MAX_STILL_PIXELS) {
    throw new ImagoInputError('Export exceeds the 40 megapixel still-image limit');
  }
  const canvas = createCanvas(width, height) as Canvas;
  const context = canvas.getContext('2d');
  context.scale(width / document.width, height / document.height);
  if (!document.transparent) {
    context.fillStyle = '#000000';
    context.fillRect(0, 0, document.width, document.height);
  } else {
    context.clearRect(0, 0, document.width, document.height);
  }

  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0 || layer.type === 'slot') continue;
    context.save();
    context.globalAlpha = layer.opacity;
    if (layer.blendMode === 'multiply') context.globalCompositeOperation = 'multiply';
    if (layer.type === 'background') {
      const image = await loadImage(decodeImageDataUrl(layer.src));
      context.drawImage(image, 0, 0, document.width, document.height);
    } else if (layer.type === 'image') {
      await drawImageLayer(context, layer);
    } else {
      drawTextLayer(context, layer);
    }
    context.restore();
  }
  return canvas;
}

export async function exportDocumentFile(options: {
  document: DocumentState;
  format: 'png' | 'jpg';
  outputName?: string;
  overwrite?: boolean;
  width?: number;
  height?: number;
}): Promise<{ outputPath: string; width: number; height: number; format: 'png' | 'jpg' }> {
  const width = options.width ?? options.document.width;
  const height = options.height ?? options.document.height;
  const outputPath = resolveOutputPath(
    options.outputName,
    options.document.name,
    options.format,
    options.overwrite,
  );
  const canvas = await renderDocument(options.document, options.document.layers, { width, height });
  let bytes: Buffer;
  if (options.format === 'jpg') {
    bytes = await sharp(canvas.toBuffer('image/png'))
      .flatten({ background: '#000000' })
      .jpeg({ quality: 92 })
      .toBuffer();
  } else {
    bytes = canvas.toBuffer('image/png');
  }
  writeOutput(outputPath, bytes, options.overwrite);
  return { outputPath, width, height, format: options.format };
}

export async function exportAnimationFile(options: {
  document: DocumentState;
  format: 'gif' | 'png-sequence';
  outputName?: string;
  overwrite?: boolean;
  width?: number;
  height?: number;
}): Promise<{
  format: 'gif' | 'png-sequence';
  outputPath?: string;
  framePaths?: string[];
  width: number;
  height: number;
  frameCount: number;
  fps: number;
}> {
  const document = options.document;
  const frames = document.frames.length ? document.frames : [{ id: 'frame-01', layers: document.layers }];
  const width = options.width ?? document.width;
  const height = options.height ?? document.height;
  if (width * height * frames.length > MAX_ANIMATION_PIXELS) {
    throw new ImagoInputError(
      'Animation exceeds the 80 megapixel-frame limit; choose a smaller width/height',
    );
  }
  const fps = Math.max(1, Math.min(30, Math.round(document.fps || 8)));

  if (options.format === 'png-sequence') {
    const framePaths = frames.map((_, index) =>
      resolveOutputPath(
        `${options.outputName ?? document.name}_f${String(index + 1).padStart(2, '0')}`,
        `${document.name}_f${String(index + 1).padStart(2, '0')}`,
        'png',
        options.overwrite,
      ),
    );
    for (let index = 0; index < frames.length; index += 1) {
      const canvas = await renderDocument(document, frames[index].layers, { width, height });
      writeOutput(framePaths[index], canvas.toBuffer('image/png'), options.overwrite);
    }
    return { format: options.format, framePaths, width, height, frameCount: frames.length, fps };
  }

  const outputPath = resolveOutputPath(options.outputName, document.name, 'gif', options.overwrite);
  const encoder = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (const frame of frames) {
    const rendered = await renderDocument(document, frame.layers, { width, height });
    const flat = createCanvas(width, height) as Canvas;
    const context = flat.getContext('2d');
    context.fillStyle = document.transparent ? '#080706' : '#000000';
    context.fillRect(0, 0, width, height);
    context.drawImage(rendered, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const palette = quantize(pixels, 256);
    encoder.writeFrame(applyPalette(pixels, palette), width, height, {
      palette,
      delay,
      repeat: 0,
    });
  }
  encoder.finish();
  writeOutput(outputPath, encoder.bytes(), options.overwrite);
  return { format: options.format, outputPath, width, height, frameCount: frames.length, fps };
}

async function drawImageLayer(
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  layer: ImageLayer,
) {
  const hasGrade =
    layer.grade.brightness !== 0 || layer.grade.contrast !== 0 || layer.grade.saturation !== 0;
  const source = decodeImageDataUrl(layer.src);
  const image = await loadImage(hasGrade ? await applyGradeBuffer(source, layer.grade) : source);
  const { x, y, scaleX, scaleY, rotation } = layer.transform;
  const width = layer.naturalWidth * scaleX;
  const height = layer.naturalHeight * scaleY;
  context.translate(x + width / 2, y + height / 2);
  context.rotate((rotation * Math.PI) / 180);
  if (layer.outline.enabled && layer.outline.width > 0) {
    const outlineWidth = layer.outline.width;
    context.save();
    context.shadowColor = layer.outline.color;
    context.shadowBlur = 0;
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      context.shadowOffsetX = Math.cos(angle) * outlineWidth;
      context.shadowOffsetY = Math.sin(angle) * outlineWidth;
      context.drawImage(image, -width / 2, -height / 2, width, height);
    }
    context.restore();
  }
  context.drawImage(image, -width / 2, -height / 2, width, height);
}

function drawTextLayer(
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  layer: TextLayer,
) {
  ensureFontsRegistered();
  const { x, y, scaleX, scaleY, rotation } = layer.transform;
  context.translate(x, y);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(scaleX, scaleY);
  paintTextEffect(context as unknown as CanvasRenderingContext2D, layer, 0, 0);
}

export type RenderableLayer = Layer;
