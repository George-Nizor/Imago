import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { DOCUMENTS_DIR, EXPORTS_DIR } from './paths.js';

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;
const SAFE_STEM = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,95}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
let temporaryFileCounter = 0;

export class ImagoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagoInputError';
  }
}

export function assertIdentifier(value: string, label = 'identifier'): string {
  if (!SAFE_ID.test(value)) {
    throw new ImagoInputError(
      `${label} must use 1-64 lowercase letters, numbers, hyphens, or underscores`,
    );
  }
  return value;
}

export function outputStem(value: string | undefined, fallback: string): string {
  const requested = value === undefined
    ? fallback.trim().replace(/[^A-Za-z0-9 _.-]+/g, '_').replace(/^[_ .-]+|[_ .-]+$/g, '').slice(0, 96) || 'export'
    : value.trim();
  if (!SAFE_STEM.test(requested) || requested === '.' || requested === '..') {
    throw new ImagoInputError(
      'outputName must be a filename stem using letters, numbers, spaces, dots, hyphens, or underscores',
    );
  }
  const extension = extname(requested);
  return extension ? requested.slice(0, -extension.length) : requested;
}

export function resolveOutputPath(
  requestedName: string | undefined,
  fallback: string,
  extension: string,
  overwrite = false,
): string {
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  const target = resolve(EXPORTS_DIR, `${outputStem(requestedName, fallback)}${normalizedExtension}`);
  assertInside(EXPORTS_DIR, target, 'Output path');
  if (!overwrite && existsSync(target)) {
    throw new ImagoInputError(
      `Export already exists: ${basename(target)}. Choose another outputName or set overwrite=true`,
    );
  }
  return target;
}

export function writeOutput(path: string, bytes: Uint8Array, overwrite = false): void {
  mkdirSync(EXPORTS_DIR, { recursive: true });
  writeContainedFile(
    EXPORTS_DIR,
    path,
    bytes,
    overwrite,
    `Export already exists: ${basename(path)}. Choose another outputName or set overwrite=true`,
  );
}

export function writeDocumentFile(path: string, text: string, overwrite = false): void {
  mkdirSync(DOCUMENTS_DIR, { recursive: true });
  writeContainedFile(
    DOCUMENTS_DIR,
    path,
    text,
    overwrite,
    `Document already exists: ${basename(path, '.imago.json')}. Choose another documentId or set overwrite=true`,
  );
}

export function assertExportPath(inputPath: string): string {
  if (!isAbsolute(inputPath)) {
    throw new ImagoInputError('Export path must be absolute');
  }
  let canonical: string;
  try {
    canonical = realpathSync(inputPath);
  } catch {
    throw new ImagoInputError('Export file does not exist');
  }
  assertInside(realpathSync(EXPORTS_DIR), canonical, 'Export path');
  if (!statSync(canonical).isFile()) throw new ImagoInputError('Export path is not a file');
  return canonical;
}

export async function readInputImage(inputPath: string): Promise<{
  buffer: Buffer;
  dataUrl: string;
  width: number;
  height: number;
}> {
  if (!isAbsolute(inputPath)) {
    throw new ImagoInputError('Image path must be absolute');
  }
  let metadata;
  let source: Buffer;
  try {
    const info = lstatSync(inputPath);
    if (!info.isFile() || info.size <= 0) throw new Error('not a regular image file');
    if (info.size > MAX_INPUT_BYTES) throw new ImagoInputError('Image exceeds the 64 MiB input limit');
    source = readFileSync(inputPath);
    metadata = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (cause) {
    if (cause instanceof ImagoInputError) throw cause;
    throw new ImagoInputError('Image path is unreadable or is not a supported image');
  }
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new ImagoInputError('Image has no readable dimensions');
  }
  try {
    const canonical = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: canonical.data,
      dataUrl: `data:image/png;base64,${canonical.data.toString('base64')}`,
      width: canonical.info.width,
      height: canonical.info.height,
    };
  } catch {
    throw new ImagoInputError('Image could not be decoded safely');
  }
}

export function decodeImageDataUrl(value: string): Buffer {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new ImagoInputError('Document image source is not a supported embedded image');
  const result = Buffer.from(match[1], 'base64');
  if (result.length === 0 || result.length > MAX_INPUT_BYTES) {
    throw new ImagoInputError('Embedded image is empty or exceeds the 64 MiB limit');
  }
  return result;
}

export function dataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export function assertInside(root: string, target: string, label: string): void {
  const relation = relative(resolve(root), resolve(target));
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new ImagoInputError(`${label} escapes its allowed directory`);
  }
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof ImagoInputError) return cause.message;
  return 'Imago could not complete the operation';
}

function writeContainedFile(
  root: string,
  path: string,
  bytes: Uint8Array | string,
  overwrite: boolean,
  conflictMessage: string,
): void {
  assertInside(root, path, 'Output path');
  if (!overwrite) {
    try {
      writeFileSync(path, bytes, { flag: 'wx' });
      return;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ImagoInputError(conflictMessage);
      }
      throw cause;
    }
  }

  // Stage beside the target and replace the directory entry. This prevents an
  // existing symlink or hard link from redirecting an explicit overwrite.
  const temporaryPath = resolve(
    root,
    `.${basename(path)}.${process.pid}.${temporaryFileCounter += 1}.tmp`,
  );
  assertInside(root, temporaryPath, 'Temporary output path');
  try {
    writeFileSync(temporaryPath, bytes, { flag: 'wx' });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}
