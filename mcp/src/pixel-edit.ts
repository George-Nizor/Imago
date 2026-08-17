import sharp from 'sharp';
import { ImagoInputError } from './safety.js';

export type PixelEditMode = 'erase' | 'warp' | 'bloat' | 'pucker';
export interface NormalizedPoint { x: number; y: number }

const MAX_PIXEL_EDIT_PIXELS = 16_000_000;

/**
 * Headless port of Imago's pointer-driven erase/liquify math. Coordinates and
 * radius are normalized so a recipe remains meaningful if the source changes
 * resolution. Liquify deliberately uses the editor's half-resolution working
 * mesh and high-quality upscale.
 */
export async function editImagePixels(options: {
  input: Buffer;
  mode: PixelEditMode;
  points: NormalizedPoint[];
  radius: number;
  strength: number;
  soft: boolean;
}): Promise<Buffer> {
  const metadata = await sharp(options.input).metadata();
  if (!metadata.width || !metadata.height) throw new ImagoInputError('Image has no readable dimensions');
  if (metadata.width * metadata.height > MAX_PIXEL_EDIT_PIXELS) {
    throw new ImagoInputError('Pixel edit exceeds the 16 megapixel working limit');
  }
  if (options.mode !== 'erase' && options.points.length < 2) {
    throw new ImagoInputError('Liquify requires at least two stroke points');
  }
  if (options.points.length < 1) throw new ImagoInputError('Pixel edit requires at least one stroke point');

  return options.mode === 'erase'
    ? erasePixels(options.input, metadata.width, metadata.height, options)
    : liquifyPixels(options.input, metadata.width, metadata.height, {
        ...options,
        mode: options.mode,
      } as {
        mode: Exclude<PixelEditMode, 'erase'>;
        points: NormalizedPoint[];
        radius: number;
        strength: number;
      });
}

async function erasePixels(
  input: Buffer,
  width: number,
  height: number,
  options: {
    points: NormalizedPoint[];
    radius: number;
    strength: number;
    soft: boolean;
  },
): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const radius = Math.max(1, options.radius * Math.min(width, height));
  const radiusSquared = radius * radius;
  for (const point of options.points) {
    const centerX = point.x * width;
    const centerY = point.y * height;
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(height - 1, Math.ceil(centerY + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > radiusSquared) continue;
        const normalizedDistance = Math.sqrt(distanceSquared) / radius;
        const brushAlpha = options.soft
          ? 0.85 * (1 - normalizedDistance)
          : normalizedDistance <= 0.85
            ? 1
            : (1 - normalizedDistance) / 0.15;
        const alphaIndex = (y * width + x) * info.channels + 3;
        data[alphaIndex] = Math.round(
          data[alphaIndex] * (1 - Math.max(0, brushAlpha) * options.strength),
        );
      }
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function liquifyPixels(
  input: Buffer,
  width: number,
  height: number,
  options: {
    mode: Exclude<PixelEditMode, 'erase'>;
    points: NormalizedPoint[];
    radius: number;
    strength: number;
  },
): Promise<Buffer> {
  const previewScale = 0.5;
  const previewWidth = Math.max(1, Math.round(width * previewScale));
  const previewHeight = Math.max(1, Math.round(height * previewScale));
  const { data: source, info } = await sharp(input)
    .ensureAlpha()
    .resize(previewWidth, previewHeight, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(source.length);
  const mapX = new Float32Array(previewWidth * previewHeight);
  const mapY = new Float32Array(previewWidth * previewHeight);
  for (let y = 0; y < previewHeight; y += 1) {
    for (let x = 0; x < previewWidth; x += 1) {
      const index = y * previewWidth + x;
      mapX[index] = x;
      mapY[index] = y;
    }
  }

  const radius = Math.max(1, options.radius * Math.min(previewWidth, previewHeight));
  const radiusSquared = radius * radius;
  for (let pointIndex = 1; pointIndex < options.points.length; pointIndex += 1) {
    const current = options.points[pointIndex];
    const previous = options.points[pointIndex - 1];
    const centerX = current.x * previewWidth;
    const centerY = current.y * previewHeight;
    const deltaX = (current.x - previous.x) * previewWidth;
    const deltaY = (current.y - previous.y) * previewHeight;
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(previewWidth - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(previewHeight - 1, Math.ceil(centerY + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const offsetX = x - centerX;
        const offsetY = y - centerY;
        const distanceSquared = offsetX * offsetX + offsetY * offsetY;
        if (distanceSquared > radiusSquared || distanceSquared === 0) continue;
        const distance = Math.sqrt(distanceSquared);
        const t = 1 - distance / radius;
        const falloff = t * t * (3 - 2 * t);
        const index = y * previewWidth + x;
        if (options.mode === 'warp') {
          mapX[index] -= deltaX * falloff * options.strength;
          mapY[index] -= deltaY * falloff * options.strength;
        } else {
          const displacement = falloff * options.strength * radius * 0.15;
          const direction = options.mode === 'bloat' ? -1 : 1;
          mapX[index] += direction * (offsetX / distance) * displacement;
          mapY[index] += direction * (offsetY / distance) * displacement;
        }
      }
    }
  }

  for (let y = 0; y < previewHeight; y += 1) {
    for (let x = 0; x < previewWidth; x += 1) {
      const pixelIndex = y * previewWidth + x;
      const sourceX = mapX[pixelIndex];
      const sourceY = mapY[pixelIndex];
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const outputOffset = pixelIndex * info.channels;
      if (x0 < 0 || y0 < 0 || x0 >= previewWidth || y0 >= previewHeight) {
        output[outputOffset + 3] = 0;
        continue;
      }
      const x1 = Math.min(previewWidth - 1, x0 + 1);
      const y1 = Math.min(previewHeight - 1, y0 + 1);
      const fractionX = sourceX - x0;
      const fractionY = sourceY - y0;
      const i00 = (y0 * previewWidth + x0) * info.channels;
      const i10 = (y0 * previewWidth + x1) * info.channels;
      const i01 = (y1 * previewWidth + x0) * info.channels;
      const i11 = (y1 * previewWidth + x1) * info.channels;
      for (let channel = 0; channel < info.channels; channel += 1) {
        output[outputOffset + channel] = Math.round(
          source[i00 + channel] * (1 - fractionX) * (1 - fractionY) +
          source[i10 + channel] * fractionX * (1 - fractionY) +
          source[i01 + channel] * (1 - fractionX) * fractionY +
          source[i11 + channel] * fractionX * fractionY,
        );
      }
    }
  }

  return sharp(output, { raw: info })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}
