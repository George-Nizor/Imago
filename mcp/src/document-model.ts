import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type {
  AnimFrame,
  BackgroundLayer,
  BeautySettings,
  BrandKit as EditorBrandKit,
  DocumentState,
  GradeSettings,
  ImageLayer,
  Layer,
  LayerRole,
  SlotMeta,
  TextEffect,
  TextLayer,
  Transform,
} from '../../src/types/document.js';
import {
  DEFAULT_BEAUTY,
  DEFAULT_GRADE,
  DEFAULT_OUTLINE,
  createTransform,
  defaultTextEffects,
} from '../../src/types/document.js';
import {
  DEFAULT_TEMPLATE_ID,
  DEFAULT_THUMBNAIL_SIZE_ID,
  THUMBNAIL_SIZES,
  THUMBNAIL_TEMPLATES,
  fitImageToBox,
  slotMeta,
} from '../../src/lib/templates.js';
import { applyTextPreset, TEXT_EFFECT_PRESETS } from '../../src/lib/textEffects.js';
import { renderBackgroundBuffer } from './backgrounds.js';
import { editImagePixels, type NormalizedPoint, type PixelEditMode } from './pixel-edit.js';
import {
  BACKGROUND_VARIANTS,
  DOCUMENTS_DIR,
  ensureDirs,
  loadBrand,
  type BackgroundVariant,
} from './paths.js';
import {
  ImagoInputError,
  assertIdentifier,
  dataUrl,
  decodeImageDataUrl,
  readInputImage,
  writeDocumentFile,
} from './safety.js';

export const DOCUMENT_SCHEMA_VERSION = 1;
export const MAX_DOCUMENT_LAYERS = 100;
export const MAX_ANIMATION_FRAMES = 48;
export const TEXT_EFFECT_IDS = TEXT_EFFECT_PRESETS.map((preset) => preset.id);

export interface DocumentEnvelope {
  schemaVersion: 1;
  kind: 'imago-document';
  document: DocumentState;
}

export interface DocumentSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  transparent: boolean;
  templateId?: string;
  layerCount: number;
  frameCount: number;
  fps: number;
  filePath: string;
  contentHash: string;
}

function editorBrand(): EditorBrandKit {
  return loadBrand() as EditorBrandKit;
}

function cloneLayers(layers: Layer[]): Layer[] {
  return structuredClone(layers);
}

function documentPath(documentId: string): string {
  return join(DOCUMENTS_DIR, `${assertIdentifier(documentId, 'documentId')}.imago.json`);
}

function documentLockPath(documentId: string): string {
  return join(DOCUMENTS_DIR, `.${assertIdentifier(documentId, 'documentId')}.lock`);
}

export function documentContentHash(document: DocumentState): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

function acquireDocumentLock(documentId: string): () => void {
  ensureDirs();
  const lockPath = documentLockPath(documentId);
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, 'wx');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
    let owner = 0;
    try {
      owner = Number.parseInt(readFileSync(lockPath, 'utf8'), 10);
      if (Number.isInteger(owner) && owner > 0) process.kill(owner, 0);
      throw new ImagoInputError(`Document is busy: ${documentId}. Retry after the active edit finishes`);
    } catch (ownerCause) {
      if (ownerCause instanceof ImagoInputError) throw ownerCause;
      if ((ownerCause as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw new ImagoInputError(`Document is busy: ${documentId}. Remove the stale lock only after confirming no Imago MCP process is editing it`);
      }
      try {
        unlinkSync(lockPath);
        descriptor = openSync(lockPath, 'wx');
      } catch {
        throw new ImagoInputError(`Document is busy: ${documentId}. Retry after the active edit finishes`);
      }
    }
  }
  writeFileSync(descriptor, String(process.pid));
  return () => {
    try {
      closeSync(descriptor);
    } finally {
      try {
        unlinkSync(lockPath);
      } catch {
        // The edit has already finished; a missing cleanup entry is harmless.
      }
    }
  };
}

function saveDocumentUnlocked(document: DocumentState, overwrite: boolean): void {
  const envelope: DocumentEnvelope = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    kind: 'imago-document',
    document,
  };
  writeDocumentFile(
    documentPath(document.id),
    `${JSON.stringify(envelope, null, 2)}\n`,
    overwrite,
  );
}

function assertExpectedHash(document: DocumentState, expectedHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new ImagoInputError('expectedHash must be a 64-character lowercase SHA-256 hash');
  }
  if (documentContentHash(document) !== expectedHash) throw staleDocumentError(document);
}

function staleDocumentError(current: DocumentState): ImagoInputError {
  return new ImagoInputError(
    `Document changed since it was read. Re-read it and retry with expectedHash=${documentContentHash(current)}`,
  );
}

function generatedBackground(
  width: number,
  height: number,
  brand: EditorBrandKit,
  variant: BackgroundVariant,
  seed: number,
  slot?: SlotMeta,
): BackgroundLayer {
  return {
    id: slot ? `layer-${slot.id}` : 'layer-background',
    type: 'background',
    name: 'Background',
    role: 'background',
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal',
    ...(slot ? { slot } : {}),
    variant,
    seed,
    primary: brand.primary,
    accent: brand.accent,
    src: dataUrl(renderBackgroundBuffer(width, height, variant, brand, seed)),
  };
}

function titleLayer(
  id: string,
  text: string,
  width: number,
  height: number,
  brand: EditorBrandKit,
  options: {
    fontSize: number;
    effect: TextEffect;
    align?: TextLayer['align'];
    x?: number;
    y?: number;
    slot?: SlotMeta;
  },
): TextLayer {
  const base: TextLayer = {
    id,
    type: 'text',
    name: options.slot?.label ?? 'Title',
    role: 'text',
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal',
    ...(options.slot ? { slot: options.slot } : {}),
    text,
    fontFamily: brand.fontFamily,
    fontSize: options.fontSize,
    fontWeight: brand.fontWeight,
    fill: brand.textFill,
    stroke: brand.textStroke,
    strokeWidth: brand.textStrokeWidth,
    shadowColor: brand.shadowColor,
    shadowBlur: brand.shadowBlur,
    shadowOffsetX: 4,
    shadowOffsetY: 6,
    align: options.align ?? 'center',
    transform: createTransform(options.x ?? width / 2, options.y ?? height / 2),
    ...defaultTextEffects(),
  };
  return { ...base, ...applyTextPreset(options.effect, base), effect: options.effect };
}

function completeDocument(
  id: string,
  name: string,
  width: number,
  height: number,
  transparent: boolean,
  layers: Layer[],
  extra: Partial<DocumentState> = {},
): DocumentState {
  const frame: AnimFrame = { id: 'frame-01', layers: cloneLayers(layers) };
  return {
    id,
    name,
    width,
    height,
    transparent,
    layers,
    selectedLayerId: layers.at(-1)?.id ?? null,
    showSafeGuides: !transparent && width / height === 16 / 9,
    frames: [frame],
    activeFrameIndex: 0,
    fps: 8,
    ...extra,
  };
}

export function createDocumentModel(options: {
  documentId: string;
  name: string;
  kind: 'thumbnail' | 'title-card' | 'custom';
  templateId?: string;
  sizeId?: string;
  width?: number;
  height?: number;
  transparent?: boolean;
  title?: string;
  seed?: number;
}): DocumentState {
  const documentId = assertIdentifier(options.documentId, 'documentId');
  const brand = editorBrand();
  const seed = options.seed ?? 1;

  if (options.kind === 'thumbnail') {
    const templateId = options.templateId ?? DEFAULT_TEMPLATE_ID;
    const template = THUMBNAIL_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) throw new ImagoInputError(`Unknown thumbnail template: ${templateId}`);
    const sizeId = options.sizeId ?? DEFAULT_THUMBNAIL_SIZE_ID;
    const size = THUMBNAIL_SIZES.find((candidate) => candidate.id === sizeId);
    if (!size) throw new ImagoInputError(`Unknown thumbnail size: ${sizeId}`);
    const scale = size.height / 720;
    const backgroundDefinition = template.slots.find((slot) => slot.kind === 'background');
    const backgroundMeta = backgroundDefinition ? slotMeta(backgroundDefinition) : undefined;
    const background = generatedBackground(
      size.width,
      size.height,
      brand,
      template.background,
      seed,
      backgroundMeta,
    );
    const placeholders: Layer[] = template.slots
      .filter((slot) => slot.kind !== 'background')
      .map((slot) => ({
        id: `layer-${slot.id}`,
        type: 'slot',
        name: slot.label,
        role: slot.role,
        visible: true,
        opacity: 1,
        locked: true,
        blendMode: 'normal',
        slot: slotMeta(slot),
      }));
    const title = titleLayer(
      'layer-title',
      options.title ?? template.title.text,
      size.width,
      size.height,
      brand,
      {
        fontSize: Math.round(size.height * template.title.fontSize),
        effect: template.title.effect,
        align: template.title.align,
        x: size.width * template.title.x,
        y: size.height * template.title.y,
        slot: slotMeta(template.title, size.width),
      },
    );
    title.strokeWidth = Math.max(2, Math.round(title.strokeWidth * scale));
    title.shadowBlur = Math.round(title.shadowBlur * scale);
    title.shadowOffsetX = Math.round(title.shadowOffsetX * scale);
    title.shadowOffsetY = Math.round(title.shadowOffsetY * scale);
    const layers = [background, ...placeholders, title];
    return completeDocument(documentId, options.name, size.width, size.height, false, layers, {
      templateId: template.id,
      templateName: template.name,
      selectedLayerId:
        placeholders.find((layer) => layer.role === 'subject')?.id ?? placeholders[0]?.id ?? title.id,
    });
  }

  const width = options.kind === 'title-card' ? 1920 : options.width ?? 1920;
  const height = options.kind === 'title-card' ? 1080 : options.height ?? 1080;
  const transparent = options.kind === 'title-card' ? true : options.transparent ?? false;
  const layers: Layer[] = [];
  if (!transparent) layers.push(generatedBackground(width, height, brand, 'panels', seed));
  if (options.kind === 'title-card' || options.title) {
    layers.push(
      titleLayer(
        'layer-title',
        options.title ?? 'TITLE CARD',
        width,
        height,
        brand,
        {
          fontSize: Math.round(brand.titleSize * 1.2),
          effect: brand.defaultTextEffect ?? 'editorial',
        },
      ),
    );
  }
  return completeDocument(documentId, options.name, width, height, transparent, layers);
}

export function saveNewDocument(
  document: DocumentState,
  overwrite = false,
  expectedHash?: string,
): DocumentSummary {
  ensureDirs();
  validateDocument(document);
  const filePath = documentPath(document.id);
  const release = acquireDocumentLock(document.id);
  try {
    if (!overwrite && existsSync(filePath)) {
      throw new ImagoInputError(
        `Document already exists: ${document.id}. Choose another documentId or set overwrite=true`,
      );
    }
    if (overwrite && existsSync(filePath)) {
      if (!expectedHash) throw new ImagoInputError('expectedHash is required to overwrite a document');
      assertExpectedHash(readDocument(document.id), expectedHash);
    }
    saveDocumentUnlocked(document, overwrite);
    return summarize(document, filePath);
  } finally {
    release();
  }
}

export function readDocument(documentId: string): DocumentState {
  ensureDirs();
  const filePath = documentPath(documentId);
  let value: unknown;
  try {
    const info = lstatSync(filePath);
    if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new Error('invalid document file');
    value = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ImagoInputError(`Document not found: ${documentId}`);
    }
    throw new ImagoInputError(`Document is unreadable or invalid: ${documentId}`);
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== 'imago-document') {
    throw new ImagoInputError(`Unsupported Imago document format: ${documentId}`);
  }
  return validateDocument(value.document);
}

export function updateDocument(
  documentId: string,
  expectedHash: string,
  edit: (document: DocumentState) => DocumentState | Promise<DocumentState>,
): Promise<DocumentSummary> {
  const release = acquireDocumentLock(documentId);
  return (async () => {
    try {
      const initial = readDocument(documentId);
      assertExpectedHash(initial, expectedHash);
      const initialHash = documentContentHash(initial);
      const document = validateDocument(await edit(initial));
      if (document.id !== documentId) throw new ImagoInputError('Document ID cannot be changed');

      // Re-read immediately before the atomic publish. The per-document lock
      // serializes MCP writers; this also rejects an external edit made while a
      // long-running cutout or pixel operation was in flight.
      const current = readDocument(documentId);
      if (documentContentHash(current) !== initialHash) throw staleDocumentError(current);
      saveDocumentUnlocked(document, true);
      return summarize(document);
    } finally {
      release();
    }
  })();
}

export function listDocuments(): { documents: DocumentSummary[]; invalidFiles: string[] } {
  ensureDirs();
  const documents: DocumentSummary[] = [];
  const invalidFiles: string[] = [];
  for (const file of readdirSync(DOCUMENTS_DIR).filter((name) => name.endsWith('.imago.json')).sort()) {
    const id = file.slice(0, -'.imago.json'.length);
    try {
      documents.push(summarize(readDocument(id), documentPath(id)));
    } catch {
      invalidFiles.push(file);
    }
  }
  return { documents, invalidFiles };
}

export function deleteDocument(documentId: string, expectedHash: string): void {
  const filePath = documentPath(documentId);
  const release = acquireDocumentLock(documentId);
  try {
    assertExpectedHash(readDocument(documentId), expectedHash);
    unlinkSync(filePath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ImagoInputError(`Document not found: ${documentId}`);
    }
    throw cause;
  } finally {
    release();
  }
}

export async function replaceTemplateSlot(options: {
  documentId: string;
  expectedHash: string;
  slotId: string;
  inputPath: string;
  removeBackground?: boolean;
  outline?: boolean;
}): Promise<DocumentSummary> {
  const source = await readInputImage(options.inputPath);
  return updateDocument(options.documentId, options.expectedHash, async (document) => {
    const target = document.layers.find((layer) => layer.slot?.id === options.slotId);
    const slot = target?.slot;
    if (!target || !slot || slot.kind === 'title') {
      throw new ImagoInputError(`Image slot not found: ${options.slotId}`);
    }
    let image = source;
    if (options.removeBackground ?? Boolean(slot.cutout)) image = await removeImageBackground(source.buffer);
    const brand = editorBrand();
    const scale = document.height / 720;
    const replacement: ImageLayer = {
      id: target.id,
      type: 'image',
      name: slot.label,
      role: slot.kind === 'background' ? 'background' : target.role,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'normal',
      slot,
      src: image.dataUrl,
      naturalWidth: image.width,
      naturalHeight: image.height,
      transform: fitImageToBox(
        image.width,
        image.height,
        document.width,
        document.height,
        slot.box,
        slot.fit,
      ),
      outline: {
        ...DEFAULT_OUTLINE,
        enabled: options.outline ?? Boolean(slot.outline),
        width: Math.max(2, Math.round(brand.subjectOutlineWidth * scale)),
        color: brand.subjectOutlineColor,
      },
      grade: { ...DEFAULT_GRADE },
      beauty: { ...DEFAULT_BEAUTY },
    };
    return replaceActiveLayer(document, target.id, replacement);
  });
}

export async function importImageLayer(options: {
  documentId: string;
  expectedHash: string;
  inputPath: string;
  layerId: string;
  name?: string;
  role: Exclude<LayerRole, 'background' | 'text'>;
  fit?: 'contain' | 'cover';
  box?: { x: number; y: number; width: number; height: number };
  removeBackground?: boolean;
  outline?: boolean;
}): Promise<DocumentSummary> {
  assertIdentifier(options.layerId, 'layerId');
  const source = await readInputImage(options.inputPath);
  const image = options.removeBackground ? await removeImageBackground(source.buffer) : source;
  return updateDocument(options.documentId, options.expectedHash, (document) => {
    if (document.layers.some((layer) => layer.id === options.layerId)) {
      throw new ImagoInputError(`Layer already exists: ${options.layerId}`);
    }
    if (document.layers.length >= MAX_DOCUMENT_LAYERS) {
      throw new ImagoInputError(`Document already has ${MAX_DOCUMENT_LAYERS} layers`);
    }
    const box = options.box ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    assertNormalizedBox(box);
    const brand = editorBrand();
    const layer: ImageLayer = {
      id: options.layerId,
      type: 'image',
      name: options.name?.trim() || (options.role === 'subject' ? 'Subject' : 'Support'),
      role: options.role,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'normal',
      src: image.dataUrl,
      naturalWidth: image.width,
      naturalHeight: image.height,
      transform: fitImageToBox(
        image.width,
        image.height,
        document.width,
        document.height,
        box,
        options.fit ?? 'contain',
      ),
      outline: {
        ...DEFAULT_OUTLINE,
        enabled: options.outline ?? options.role === 'subject',
        color: brand.subjectOutlineColor,
        width: brand.subjectOutlineWidth,
      },
      grade: { ...DEFAULT_GRADE },
      beauty: { ...DEFAULT_BEAUTY },
    };
    const layers = [...document.layers];
    const firstText = layers.findIndex((candidate) => candidate.type === 'text');
    layers.splice(firstText < 0 ? layers.length : firstText, 0, layer);
    return commitLayers(document, layers, layer.id);
  });
}

export function addTextLayer(options: {
  documentId: string;
  expectedHash: string;
  layerId: string;
  text: string;
  name?: string;
  effect?: TextEffect;
  x?: number;
  y?: number;
  fontSize?: number;
  fontFamily?: string;
  fill?: string;
  stroke?: string;
  align?: TextLayer['align'];
}): Promise<DocumentSummary> {
  assertIdentifier(options.layerId, 'layerId');
  return updateDocument(options.documentId, options.expectedHash, (document) => {
    if (document.layers.some((layer) => layer.id === options.layerId)) {
      throw new ImagoInputError(`Layer already exists: ${options.layerId}`);
    }
    if (document.layers.length >= MAX_DOCUMENT_LAYERS) {
      throw new ImagoInputError(`Document already has ${MAX_DOCUMENT_LAYERS} layers`);
    }
    const brand = editorBrand();
    const effect = options.effect ?? brand.defaultTextEffect ?? 'basic';
    const layer = titleLayer(
      options.layerId,
      options.text,
      document.width,
      document.height,
      brand,
      {
        fontSize: options.fontSize ?? brand.subtitleSize,
        effect,
        align: options.align,
        x: (options.x ?? 0.5) * document.width,
        y: (options.y ?? 0.5) * document.height,
      },
    );
    layer.name = options.name?.trim() || 'Text';
    if (options.fontFamily) layer.fontFamily = options.fontFamily;
    if (options.fill) layer.fill = options.fill;
    if (options.stroke) layer.stroke = options.stroke;
    return commitLayers(document, [...document.layers, layer], layer.id);
  });
}

export function updateLayer(options: {
  documentId: string;
  expectedHash: string;
  layerId: string;
  name?: string;
  role?: LayerRole;
  visible?: boolean;
  opacity?: number;
  locked?: boolean;
  blendMode?: 'normal' | 'multiply';
  transform?: Partial<Transform>;
  outline?: { enabled?: boolean; width?: number; color?: string };
}): Promise<DocumentSummary> {
  return updateDocument(options.documentId, options.expectedHash, (document) => {
    const target = requireLayer(document, options.layerId);
    const replacement: Layer = {
      ...target,
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.role !== undefined ? { role: options.role } : {}),
      ...(options.visible !== undefined ? { visible: options.visible } : {}),
      ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
      ...(options.locked !== undefined ? { locked: options.locked } : {}),
      ...(options.blendMode !== undefined ? { blendMode: options.blendMode } : {}),
      ...('transform' in target && options.transform
        ? { transform: { ...target.transform, ...options.transform } }
        : {}),
      ...(target.type === 'image' && options.outline
        ? { outline: { ...target.outline, ...options.outline } }
        : {}),
    } as Layer;
    return replaceActiveLayer(document, target.id, replacement);
  });
}

export function updateTextLayer(options: {
  documentId: string;
  expectedHash: string;
  layerId: string;
  text?: string;
  effect?: TextEffect;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  align?: TextLayer['align'];
  letterSpacing?: number;
  extrudeDepth?: number;
  extrudeAngle?: number;
  extrudeColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  skewX?: number;
}): Promise<DocumentSummary> {
  return updateDocument(options.documentId, options.expectedHash, (document) => {
    const target = requireLayer(document, options.layerId);
    if (target.type !== 'text') throw new ImagoInputError(`Layer is not text: ${options.layerId}`);
    const { documentId: _documentId, expectedHash: _expectedHash, layerId: _layerId, effect, ...style } = options;
    let replacement: TextLayer = { ...target, ...style };
    if (effect) replacement = { ...replacement, ...applyTextPreset(effect, replacement), ...style, effect };
    return replaceActiveLayer(document, target.id, replacement);
  });
}

export function setBackground(options: {
  documentId: string;
  expectedHash: string;
  variant: BackgroundVariant;
  seed: number;
  primary?: string;
  accent?: string;
}): Promise<DocumentSummary> {
  return updateDocument(options.documentId, options.expectedHash, (document) => {
    const brand = { ...editorBrand(), primary: options.primary ?? editorBrand().primary, accent: options.accent ?? editorBrand().accent };
    const existing = document.layers.find((layer) => layer.role === 'background');
    const replacement = generatedBackground(
      document.width,
      document.height,
      brand,
      options.variant,
      options.seed,
      existing?.slot,
    );
    if (existing) {
      replacement.id = existing.id;
      return replaceActiveLayer(document, existing.id, replacement);
    }
    return commitLayers(document, [replacement, ...document.layers], replacement.id);
  });
}

export function deleteLayer(documentId: string, expectedHash: string, layerId: string): Promise<DocumentSummary> {
  return updateDocument(documentId, expectedHash, (document) => {
    const target = requireLayer(document, layerId);
    if (target.slot) throw new ImagoInputError('Template slot layers cannot be deleted');
    const layers = document.layers.filter((layer) => layer.id !== layerId);
    return commitLayers(document, layers, layers.at(-1)?.id ?? null);
  });
}

export function duplicateLayer(
  documentId: string,
  expectedHash: string,
  layerId: string,
  newLayerId: string,
): Promise<DocumentSummary> {
  assertIdentifier(newLayerId, 'newLayerId');
  return updateDocument(documentId, expectedHash, (document) => {
    const target = requireLayer(document, layerId);
    if (target.slot) throw new ImagoInputError('Template slot layers cannot be duplicated');
    if (document.layers.some((layer) => layer.id === newLayerId)) {
      throw new ImagoInputError(`Layer already exists: ${newLayerId}`);
    }
    const copy = structuredClone(target);
    copy.id = newLayerId;
    copy.name = `${target.name} copy`;
    if ('transform' in copy) {
      copy.transform = { ...copy.transform, x: copy.transform.x + 20, y: copy.transform.y + 20 };
    }
    const layers = [...document.layers];
    layers.splice(layers.indexOf(target) + 1, 0, copy);
    return commitLayers(document, layers, copy.id);
  });
}

export function reorderLayer(
  documentId: string,
  expectedHash: string,
  layerId: string,
  toIndex: number,
): Promise<DocumentSummary> {
  return updateDocument(documentId, expectedHash, (document) => {
    const target = requireLayer(document, layerId);
    if (target.slot) throw new ImagoInputError('Template slot layers cannot be reordered');
    const fromIndex = document.layers.indexOf(target);
    if (toIndex < 0 || toIndex >= document.layers.length) {
      throw new ImagoInputError('toIndex is outside the layer stack');
    }
    if (document.layers[toIndex]?.slot) {
      throw new ImagoInputError('Layers cannot be moved across a fixed template slot');
    }
    const layers = [...document.layers];
    const [item] = layers.splice(fromIndex, 1);
    layers.splice(toIndex, 0, item);
    return commitLayers(document, layers, document.selectedLayerId);
  });
}

export async function cutoutLayer(documentId: string, expectedHash: string, layerId: string): Promise<DocumentSummary> {
  return updateDocument(documentId, expectedHash, async (document) => {
    const target = requireLayer(document, layerId);
    if (target.type !== 'image') throw new ImagoInputError(`Layer is not an image: ${layerId}`);
    const image = await removeImageBackground(decodeImageDataUrl(target.src));
    return replaceActiveLayer(document, layerId, {
      ...target,
      src: image.dataUrl,
      naturalWidth: image.width,
      naturalHeight: image.height,
      role: 'subject',
      name: target.name === 'Support' ? 'Subject' : target.name,
    });
  });
}

export function setImageGrade(options: {
  documentId: string;
  expectedHash: string;
  layerId: string;
  grade: GradeSettings;
  bake?: boolean;
}): Promise<DocumentSummary> {
  return updateDocument(options.documentId, options.expectedHash, async (document) => {
    const target = requireLayer(document, options.layerId);
    if (target.type !== 'image') throw new ImagoInputError(`Layer is not an image: ${options.layerId}`);
    if (!options.bake) {
      return replaceActiveLayer(document, target.id, { ...target, grade: options.grade });
    }
    const graded = await applyGradeBuffer(decodeImageDataUrl(target.src), options.grade);
    return replaceActiveLayer(document, target.id, {
      ...target,
      src: dataUrl(graded),
      grade: { ...DEFAULT_GRADE },
    });
  });
}

export function applyBeautyToLayer(options: {
  documentId: string;
  expectedHash: string;
  layerId: string;
  beauty: BeautySettings;
}): Promise<DocumentSummary> {
  return updateDocument(options.documentId, options.expectedHash, async (document) => {
    const target = requireLayer(document, options.layerId);
    if (target.type !== 'image') throw new ImagoInputError(`Layer is not an image: ${options.layerId}`);
    const beautified = await applyBeautyBuffer(decodeImageDataUrl(target.src), options.beauty);
    return replaceActiveLayer(document, target.id, {
      ...target,
      src: dataUrl(beautified),
      beauty: options.beauty,
    });
  });
}

export function editImageLayerPixels(options: {
  documentId: string;
  expectedHash: string;
  layerId: string;
  mode: PixelEditMode;
  points: NormalizedPoint[];
  radius: number;
  strength: number;
  soft: boolean;
}): Promise<DocumentSummary> {
  return updateDocument(options.documentId, options.expectedHash, async (document) => {
    const target = requireLayer(document, options.layerId);
    if (target.type !== 'image') throw new ImagoInputError(`Layer is not an image: ${options.layerId}`);
    const edited = await editImagePixels({
      input: decodeImageDataUrl(target.src),
      mode: options.mode,
      points: options.points,
      radius: options.radius,
      strength: options.strength,
      soft: options.soft,
    });
    return replaceActiveLayer(document, target.id, { ...target, src: dataUrl(edited) });
  });
}

export function editAnimation(options: {
  documentId: string;
  expectedHash: string;
  action: 'duplicate' | 'delete' | 'move' | 'select' | 'set-fps';
  index?: number;
  toIndex?: number;
  fps?: number;
}): Promise<DocumentSummary> {
  return updateDocument(options.documentId, options.expectedHash, (document) => {
    if (options.action === 'set-fps') {
      if (options.fps === undefined) throw new ImagoInputError('fps is required for set-fps');
      return { ...document, fps: Math.max(1, Math.min(30, Math.round(options.fps))) };
    }
    const frames = document.frames.map((frame) => ({ ...frame, layers: cloneLayers(frame.layers) }));
    const index = options.index ?? document.activeFrameIndex;
    if (index < 0 || index >= frames.length) throw new ImagoInputError('Frame index is outside the filmstrip');
    let active = document.activeFrameIndex;
    if (options.action === 'duplicate') {
      if (frames.length >= MAX_ANIMATION_FRAMES) {
        throw new ImagoInputError(`Animation already has ${MAX_ANIMATION_FRAMES} frames`);
      }
      const nextNumber = frames.length + 1;
      const copy = { id: `frame-${String(nextNumber).padStart(2, '0')}`, layers: cloneLayers(frames[index].layers) };
      frames.splice(index + 1, 0, copy);
      active = index + 1;
    } else if (options.action === 'delete') {
      if (frames.length === 1) throw new ImagoInputError('An animation must keep at least one frame');
      frames.splice(index, 1);
      active = Math.min(index, frames.length - 1);
    } else if (options.action === 'move') {
      const toIndex = options.toIndex;
      if (toIndex === undefined || toIndex < 0 || toIndex >= frames.length) {
        throw new ImagoInputError('toIndex is outside the filmstrip');
      }
      const [frame] = frames.splice(index, 1);
      frames.splice(toIndex, 0, frame);
      if (active === index) active = toIndex;
      else if (index < active && toIndex >= active) active -= 1;
      else if (index > active && toIndex <= active) active += 1;
    } else {
      active = index;
    }
    const layers = cloneLayers(frames[active].layers);
    return {
      ...document,
      frames,
      activeFrameIndex: active,
      layers,
      selectedLayerId: layers.at(-1)?.id ?? null,
      fps: document.fps,
    };
  });
}

export function summarize(document: DocumentState, filePath = documentPath(document.id)): DocumentSummary {
  return {
    id: document.id,
    name: document.name,
    width: document.width,
    height: document.height,
    transparent: document.transparent,
    ...(document.templateId ? { templateId: document.templateId } : {}),
    layerCount: document.layers.length,
    frameCount: document.frames.length,
    fps: document.fps,
    filePath,
    contentHash: documentContentHash(document),
  };
}

export function templateCatalog() {
  return {
    templates: THUMBNAIL_TEMPLATES,
    sizes: THUMBNAIL_SIZES,
    backgrounds: BACKGROUND_VARIANTS,
    textEffects: TEXT_EFFECT_PRESETS,
  };
}

export function validateDocument(value: unknown): DocumentState {
  if (!isRecord(value)) throw new ImagoInputError('Document payload must be an object');
  assertIdentifier(requireString(value.id, 'document.id'), 'document.id');
  requireString(value.name, 'document.name', 120);
  requireInteger(value.width, 'document.width', 64, 8192);
  requireInteger(value.height, 'document.height', 64, 8192);
  if (typeof value.transparent !== 'boolean') throw new ImagoInputError('document.transparent must be boolean');
  if (!Array.isArray(value.layers) || value.layers.length > MAX_DOCUMENT_LAYERS) {
    throw new ImagoInputError(`document.layers must contain at most ${MAX_DOCUMENT_LAYERS} layers`);
  }
  const layers = value.layers.map(validateLayer);
  assertUniqueLayerIds(layers, 'document.layers');
  if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > MAX_ANIMATION_FRAMES) {
    throw new ImagoInputError(`document.frames must contain 1-${MAX_ANIMATION_FRAMES} frames`);
  }
  const frames = value.frames.map((candidate, index) => {
    if (!isRecord(candidate)) throw new ImagoInputError(`document.frames[${index}] must be an object`);
    const id = requireString(candidate.id, `document.frames[${index}].id`, 80);
    if (!Array.isArray(candidate.layers) || candidate.layers.length > MAX_DOCUMENT_LAYERS) {
      throw new ImagoInputError(`document.frames[${index}].layers is invalid`);
    }
    const frameLayers = candidate.layers.map(validateLayer);
    assertUniqueLayerIds(frameLayers, `document.frames[${index}].layers`);
    return { id, layers: frameLayers };
  });
  const frameIds = new Set<string>();
  for (const frame of frames) {
    if (frameIds.has(frame.id)) throw new ImagoInputError(`document.frames contains duplicate frame ID: ${frame.id}`);
    frameIds.add(frame.id);
  }
  const activeFrameIndex = requireInteger(value.activeFrameIndex, 'document.activeFrameIndex', 0, frames.length - 1);
  const fps = requireInteger(value.fps, 'document.fps', 1, 30);
  if (value.selectedLayerId !== null && typeof value.selectedLayerId !== 'string') {
    throw new ImagoInputError('document.selectedLayerId must be a layer ID or null');
  }
  if (typeof value.selectedLayerId === 'string' && !layers.some((layer) => layer.id === value.selectedLayerId)) {
    throw new ImagoInputError('document.selectedLayerId does not identify an active layer');
  }
  if (typeof value.showSafeGuides !== 'boolean') throw new ImagoInputError('document.showSafeGuides must be boolean');
  if (value.templateId !== undefined) requireString(value.templateId, 'document.templateId', 80);
  if (value.templateName !== undefined) requireString(value.templateName, 'document.templateName', 120);
  return {
    ...(value as unknown as DocumentState),
    layers,
    frames,
    activeFrameIndex,
    fps,
  };
}

function validateLayer(value: unknown): Layer {
  if (!isRecord(value)) throw new ImagoInputError('Layer must be an object');
  const layerId = assertIdentifier(requireString(value.id, 'layer.id'), 'layer.id');
  requireString(value.name, 'layer.name', 120);
  if (!['background', 'subject', 'support', 'text', 'none'].includes(String(value.role))) {
    throw new ImagoInputError(`Layer ${value.id} has an invalid role`);
  }
  if (typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean') {
    throw new ImagoInputError(`Layer ${value.id} visibility/lock state is invalid`);
  }
  requireNumber(value.opacity, `layer ${layerId} opacity`, 0, 1);
  if (!['normal', 'multiply'].includes(String(value.blendMode))) {
    throw new ImagoInputError(`Layer ${layerId} has an invalid blend mode`);
  }
  if (value.slot !== undefined) validateSlot(value.slot);
  if (value.type === 'slot') return value as unknown as Layer;
  if (value.type === 'background') {
    if (!BACKGROUND_VARIANTS.includes(value.variant as BackgroundVariant)) {
      throw new ImagoInputError(`Layer ${layerId} has an invalid background variant`);
    }
    requireInteger(value.seed, `layer ${layerId} seed`, 0, 2_147_483_647);
    requireString(value.primary, `layer ${layerId} primary`, 100);
    requireString(value.accent, `layer ${layerId} accent`, 100);
    decodeImageDataUrl(requireString(value.src, `layer ${layerId} src`, 100_000_000));
    return value as unknown as Layer;
  }
  if (value.type === 'image') {
    decodeImageDataUrl(requireString(value.src, `layer ${layerId} src`, 100_000_000));
    requireInteger(value.naturalWidth, `layer ${layerId} naturalWidth`, 1, 32768);
    requireInteger(value.naturalHeight, `layer ${layerId} naturalHeight`, 1, 32768);
    validateTransform(value.transform, layerId);
    if (!isRecord(value.grade) || !isRecord(value.beauty) || !isRecord(value.outline)) {
      throw new ImagoInputError(`Layer ${layerId} image settings are invalid`);
    }
    if (typeof value.outline.enabled !== 'boolean') {
      throw new ImagoInputError(`Layer ${layerId} outline enabled state is invalid`);
    }
    requireNumber(value.outline.width, `layer ${layerId} outline width`, 0, 500);
    requireString(value.outline.color, `layer ${layerId} outline color`, 100);
    requireNumber(value.grade.brightness, `layer ${layerId} brightness`, -50, 50);
    requireNumber(value.grade.contrast, `layer ${layerId} contrast`, -50, 50);
    requireNumber(value.grade.saturation, `layer ${layerId} saturation`, -50, 50);
    requireNumber(value.beauty.amount, `layer ${layerId} beauty amount`, 0, 100);
    requireNumber(value.beauty.smooth, `layer ${layerId} beauty smooth`, 0, 1);
    requireNumber(value.beauty.eyes, `layer ${layerId} beauty eyes`, 0, 1);
    requireNumber(value.beauty.teeth, `layer ${layerId} beauty teeth`, 0, 1);
    requireNumber(value.beauty.underEye, `layer ${layerId} beauty underEye`, 0, 1);
    return value as unknown as Layer;
  }
  if (value.type === 'text') {
    requireString(value.text, `layer ${layerId} text`, 500);
    requireString(value.fontFamily, `layer ${layerId} fontFamily`, 200);
    requireNumber(value.fontSize, `layer ${layerId} fontSize`, 1, 2000);
    requireInteger(value.fontWeight, `layer ${layerId} fontWeight`, 100, 1000);
    requireString(value.fill, `layer ${layerId} fill`, 100);
    requireString(value.stroke, `layer ${layerId} stroke`, 100);
    requireNumber(value.strokeWidth, `layer ${layerId} strokeWidth`, 0, 500);
    requireString(value.shadowColor, `layer ${layerId} shadowColor`, 100);
    requireNumber(value.shadowBlur, `layer ${layerId} shadowBlur`, 0, 500);
    requireNumber(value.shadowOffsetX, `layer ${layerId} shadowOffsetX`, -1000, 1000);
    requireNumber(value.shadowOffsetY, `layer ${layerId} shadowOffsetY`, -1000, 1000);
    if (!['left', 'center', 'right'].includes(String(value.align))) {
      throw new ImagoInputError(`Layer ${layerId} has an invalid text alignment`);
    }
    if (!TEXT_EFFECT_IDS.includes(value.effect as TextEffect)) {
      throw new ImagoInputError(`Layer ${layerId} has an invalid text effect`);
    }
    requireNumber(value.extrudeDepth, `layer ${layerId} extrudeDepth`, 0, 500);
    requireNumber(value.extrudeAngle, `layer ${layerId} extrudeAngle`, 0, 360);
    requireString(value.extrudeColor, `layer ${layerId} extrudeColor`, 100);
    requireString(value.gradientFrom, `layer ${layerId} gradientFrom`, 100);
    requireString(value.gradientTo, `layer ${layerId} gradientTo`, 100);
    requireString(value.outerStroke, `layer ${layerId} outerStroke`, 100);
    requireNumber(value.outerStrokeWidth, `layer ${layerId} outerStrokeWidth`, 0, 500);
    requireNumber(value.letterSpacing, `layer ${layerId} letterSpacing`, -100, 500);
    requireNumber(value.skewX, `layer ${layerId} skewX`, -0.35, 0.35);
    validateTransform(value.transform, layerId);
    return value as unknown as Layer;
  }
  throw new ImagoInputError(`Layer ${layerId} has an invalid type`);
}

function validateSlot(value: unknown): void {
  if (!isRecord(value)) throw new ImagoInputError('Layer slot metadata is invalid');
  requireString(value.id, 'slot.id', 80);
  requireString(value.label, 'slot.label', 120);
  if (!['background', 'subject', 'support', 'title'].includes(String(value.kind))) {
    throw new ImagoInputError('Layer slot kind is invalid');
  }
  if (!['contain', 'cover'].includes(String(value.fit))) throw new ImagoInputError('Layer slot fit is invalid');
  assertNormalizedBox(value.box);
}

function validateTransform(value: unknown, layerId: string): void {
  if (!isRecord(value)) throw new ImagoInputError(`Layer ${layerId} transform is invalid`);
  requireNumber(value.x, `layer ${layerId} x`, -100_000, 100_000);
  requireNumber(value.y, `layer ${layerId} y`, -100_000, 100_000);
  requireNumber(value.scaleX, `layer ${layerId} scaleX`, -100, 100);
  requireNumber(value.scaleY, `layer ${layerId} scaleY`, -100, 100);
  requireNumber(value.rotation, `layer ${layerId} rotation`, -36_000, 36_000);
}

function assertNormalizedBox(value: unknown): asserts value is { x: number; y: number; width: number; height: number } {
  if (!isRecord(value)) throw new ImagoInputError('Image box must be an object');
  const x = requireNumber(value.x, 'box.x', 0, 1);
  const y = requireNumber(value.y, 'box.y', 0, 1);
  const width = requireNumber(value.width, 'box.width', 0.000001, 1);
  const height = requireNumber(value.height, 'box.height', 0.000001, 1);
  if (x + width > 1.000001 || y + height > 1.000001) {
    throw new ImagoInputError('Image box must remain inside normalized canvas bounds');
  }
}

function commitLayers(document: DocumentState, layers: Layer[], selectedLayerId: string | null): DocumentState {
  const frames = document.frames.map((frame, index) =>
    index === document.activeFrameIndex ? { ...frame, layers: cloneLayers(layers) } : frame,
  );
  return { ...document, layers, frames, selectedLayerId };
}

function replaceActiveLayer(document: DocumentState, layerId: string, replacement: Layer): DocumentState {
  return commitLayers(
    document,
    document.layers.map((layer) => (layer.id === layerId ? replacement : layer)),
    replacement.id,
  );
}

function requireLayer(document: DocumentState, layerId: string): Layer {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new ImagoInputError(`Layer not found: ${layerId}`);
  return layer;
}

async function removeImageBackground(input: Buffer): Promise<{
  buffer: Buffer;
  dataUrl: string;
  width: number;
  height: number;
}> {
  try {
    const { removeBackground } = await import('@imgly/background-removal-node');
    const blob = await removeBackground(input);
    const buffer = Buffer.from(await blob.arrayBuffer());
    const canonical = await sharp(buffer).ensureAlpha().png().toBuffer({ resolveWithObject: true });
    return {
      buffer: canonical.data,
      dataUrl: dataUrl(canonical.data),
      width: canonical.info.width,
      height: canonical.info.height,
    };
  } catch {
    throw new ImagoInputError('Local background removal failed; the document was not changed');
  }
}

export async function applyGradeBuffer(input: Buffer, grade: GradeSettings): Promise<Buffer> {
  const brightness = 1 + grade.brightness / 100;
  const saturation = 1 + grade.saturation / 100;
  const contrast = 1 + grade.contrast / 100;
  return sharp(input)
    .modulate({ brightness, saturation })
    .linear(contrast, 128 * (1 - contrast))
    .png()
    .toBuffer();
}

export async function applyBeautyBuffer(input: Buffer, beauty: BeautySettings): Promise<Buffer> {
  const amount = Math.max(0, Math.min(100, beauty.amount)) / 100;
  if (amount <= 0.01) return sharp(input).png().toBuffer();
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(input);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const smoothStrength = amount * beauty.smooth;
  if (smoothStrength > 0.05) {
    const blurredCanvas = createCanvas(image.width, image.height);
    const blurredContext = blurredCanvas.getContext('2d');
    const radius = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.008 * (0.5 + smoothStrength)));
    blurredContext.filter = `blur(${radius}px)`;
    blurredContext.drawImage(image, 0, 0);
    const original = context.getImageData(0, 0, image.width, image.height);
    const blurred = blurredContext.getImageData(0, 0, image.width, image.height);
    for (let index = 0; index < original.data.length; index += 4) {
      if (original.data[index + 3] < 10) continue;
      const red = original.data[index];
      const green = original.data[index + 1];
      const blue = original.data[index + 2];
      const mix = smoothStrength * (isSkinTone(red, green, blue) ? 1 : 0.15);
      original.data[index] = red * (1 - mix) + blurred.data[index] * mix;
      original.data[index + 1] = green * (1 - mix) + blurred.data[index + 1] * mix;
      original.data[index + 2] = blue * (1 - mix) + blurred.data[index + 2] * mix;
    }
    context.putImageData(original, 0, 0);
  }
  const eyeAmount = amount * beauty.eyes * 0.12;
  const teethAmount = amount * beauty.teeth * 0.1;
  const underEyeAmount = amount * beauty.underEye * 0.08;
  const pixels = context.getImageData(0, 0, image.width, image.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index + 3] < 10) continue;
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    if (luminance > 90 && luminance < 200 && !isSkinTone(red, green, blue)) {
      pixels.data[index] = clampByte(red + 255 * eyeAmount);
      pixels.data[index + 1] = clampByte(green + 255 * eyeAmount);
      pixels.data[index + 2] = clampByte(blue + 255 * eyeAmount);
    }
    if (luminance > 160 && Math.abs(red - green) < 25 && Math.abs(green - blue) < 25) {
      pixels.data[index] = clampByte(red + 255 * teethAmount);
      pixels.data[index + 1] = clampByte(green + 255 * teethAmount);
      pixels.data[index + 2] = clampByte(blue + 255 * teethAmount * 0.9);
    }
    if (isSkinTone(red, green, blue) && luminance < 110) {
      pixels.data[index] = clampByte(red + 255 * underEyeAmount);
      pixels.data[index + 1] = clampByte(green + 255 * underEyeAmount);
      pixels.data[index + 2] = clampByte(blue + 255 * underEyeAmount);
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toBuffer('image/png');
}

function isSkinTone(red: number, green: number, blue: number): boolean {
  return red > 60 && green > 30 && blue > 15 && red > green && red > blue && red - green > 10 && red - blue > 15;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function assertUniqueLayerIds(layers: Layer[], path: string): void {
  const ids = new Set<string>();
  for (const layer of layers) {
    if (ids.has(layer.id)) throw new ImagoInputError(`${path} contains duplicate layer ID: ${layer.id}`);
    ids.add(layer.id);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, label: string, maxLength = 120): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ImagoInputError(`${label} must be a non-empty string no longer than ${maxLength}`);
  }
  return value;
}

function requireNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ImagoInputError(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function requireInteger(value: unknown, label: string, min: number, max: number): number {
  const result = requireNumber(value, label, min, max);
  if (!Number.isInteger(result)) throw new ImagoInputError(`${label} must be an integer`);
  return result;
}
