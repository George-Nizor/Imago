import type { DocumentState, Layer } from '../types/document';

const MAX_LAYERS = 100;
const MAX_FRAMES = 48;
const DOCUMENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isImagoDocumentId(value: string): boolean {
  return DOCUMENT_ID.test(value);
}

export function parseImagoDocumentEnvelope(value: unknown): DocumentState {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== 'imago-document') {
    throw new Error('Unsupported Imago document format');
  }
  return validateDocument(value.document);
}

function validateDocument(value: unknown): DocumentState {
  if (!isRecord(value)) throw new Error('Document payload is invalid');
  if (typeof value.id !== 'string' || !isImagoDocumentId(value.id)) throw new Error('Document ID is invalid');
  if (typeof value.name !== 'string' || !value.name || value.name.length > 120) throw new Error('Document name is invalid');
  if (!integerBetween(value.width, 64, 8192) || !integerBetween(value.height, 64, 8192)) {
    throw new Error('Document dimensions are invalid');
  }
  if (typeof value.transparent !== 'boolean' || typeof value.showSafeGuides !== 'boolean') {
    throw new Error('Document display state is invalid');
  }
  if (!Array.isArray(value.layers) || value.layers.length > MAX_LAYERS) throw new Error('Document layers are invalid');
  const layers = value.layers.map(validateLayer);
  uniqueLayerIds(layers);
  if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > MAX_FRAMES) {
    throw new Error('Document frames are invalid');
  }
  const frames = value.frames.map((frame) => {
    if (!isRecord(frame) || !shortString(frame.id, 80) || !Array.isArray(frame.layers)) {
      throw new Error('Animation frame is invalid');
    }
    if (frame.layers.length > MAX_LAYERS) throw new Error('Animation frame has too many layers');
    const frameLayers = frame.layers.map(validateLayer);
    uniqueLayerIds(frameLayers);
    return { id: frame.id, layers: frameLayers };
  });
  if (new Set(frames.map((frame) => frame.id)).size !== frames.length) {
    throw new Error('Animation frame IDs must be unique');
  }
  if (!integerBetween(value.activeFrameIndex, 0, frames.length - 1) || !integerBetween(value.fps, 1, 30)) {
    throw new Error('Animation state is invalid');
  }
  if (value.selectedLayerId !== null && typeof value.selectedLayerId !== 'string') {
    throw new Error('Layer selection is invalid');
  }
  if (typeof value.selectedLayerId === 'string' && !layers.some((layer) => layer.id === value.selectedLayerId)) {
    throw new Error('Selected layer does not exist');
  }
  return {
    ...(value as unknown as DocumentState),
    layers,
    frames,
  };
}

function validateLayer(value: unknown): Layer {
  if (!isRecord(value) || typeof value.id !== 'string' || !DOCUMENT_ID.test(value.id)) {
    throw new Error('Layer is invalid');
  }
  if (!['slot', 'image', 'text', 'background'].includes(String(value.type))) {
    throw new Error('Layer type is invalid');
  }
  if (!shortString(value.name, 120) || typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean') {
    throw new Error('Layer state is invalid');
  }
  if (!['background', 'subject', 'support', 'text', 'none'].includes(String(value.role))) {
    throw new Error('Layer role is invalid');
  }
  if (!['normal', 'multiply'].includes(String(value.blendMode))) {
    throw new Error('Layer blend mode is invalid');
  }
  if (typeof value.opacity !== 'number' || value.opacity < 0 || value.opacity > 1) {
    throw new Error('Layer opacity is invalid');
  }
  if (value.slot !== undefined && !validSlot(value.slot)) {
    throw new Error('Layer slot metadata is invalid');
  }
  if ((value.type === 'image' || value.type === 'background') && !embeddedImage(value.src)) {
    throw new Error('Layer media must be an embedded image');
  }
  if ((value.type === 'image' || value.type === 'text') && !validTransform(value.transform)) {
    throw new Error('Layer transform is invalid');
  }
  if (value.type === 'image' && !validImageSettings(value)) {
    throw new Error('Layer image settings are invalid');
  }
  if (value.type === 'background' && !validBackground(value)) {
    throw new Error('Background layer settings are invalid');
  }
  if (value.type === 'text' && !validText(value)) {
    throw new Error('Text layer settings are invalid');
  }
  return value as unknown as Layer;
}

function embeddedImage(value: unknown): boolean {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

function validTransform(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['x', 'y', 'scaleX', 'scaleY', 'rotation'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    )
  );
}

function validSlot(value: unknown): boolean {
  if (!isRecord(value) || !shortString(value.id, 80) || !shortString(value.label, 120)) return false;
  if (!['background', 'subject', 'support', 'title'].includes(String(value.kind))) return false;
  if (!['contain', 'cover'].includes(String(value.fit)) || !isRecord(value.box)) return false;
  const { x, y, width, height } = value.box;
  return (
    finiteBetween(x, 0, 1) &&
    finiteBetween(y, 0, 1) &&
    finiteBetween(width, Number.EPSILON, 1) &&
    finiteBetween(height, Number.EPSILON, 1) &&
    x + width <= 1.000001 &&
    y + height <= 1.000001 &&
    (value.canvasWidth === undefined || integerBetween(value.canvasWidth, 64, 8192)) &&
    (value.cutout === undefined || typeof value.cutout === 'boolean') &&
    (value.outline === undefined || typeof value.outline === 'boolean')
  );
}

function validImageSettings(value: Record<string, unknown>): boolean {
  if (!integerBetween(value.naturalWidth, 1, 32768) || !integerBetween(value.naturalHeight, 1, 32768)) {
    return false;
  }
  const outline = value.outline;
  const grade = value.grade;
  const beauty = value.beauty;
  return (
    isRecord(outline) &&
    typeof outline.enabled === 'boolean' &&
    finiteBetween(outline.width, 0, 500) &&
    shortString(outline.color, 100) &&
    isRecord(grade) &&
    finiteBetween(grade.brightness, -50, 50) &&
    finiteBetween(grade.contrast, -50, 50) &&
    finiteBetween(grade.saturation, -50, 50) &&
    isRecord(beauty) &&
    finiteBetween(beauty.amount, 0, 100) &&
    finiteBetween(beauty.smooth, 0, 1) &&
    finiteBetween(beauty.eyes, 0, 1) &&
    finiteBetween(beauty.teeth, 0, 1) &&
    finiteBetween(beauty.underEye, 0, 1)
  );
}

function validBackground(value: Record<string, unknown>): boolean {
  return (
    ['solid', 'split', 'linear', 'radial', 'panels', 'wash', 'punch'].includes(String(value.variant)) &&
    integerBetween(value.seed, 0, 2_147_483_647) &&
    shortString(value.primary, 100) &&
    shortString(value.accent, 100)
  );
}

function validText(value: Record<string, unknown>): boolean {
  const numericFields: Array<[string, number, number]> = [
    ['fontSize', 1, 2000],
    ['fontWeight', 100, 1000],
    ['strokeWidth', 0, 500],
    ['shadowBlur', 0, 500],
    ['shadowOffsetX', -1000, 1000],
    ['shadowOffsetY', -1000, 1000],
    ['extrudeDepth', 0, 500],
    ['extrudeAngle', 0, 360],
    ['outerStrokeWidth', 0, 500],
    ['letterSpacing', -100, 500],
    ['skewX', -0.35, 0.35],
  ];
  const stringFields = [
    'fontFamily',
    'fill',
    'stroke',
    'shadowColor',
    'extrudeColor',
    'gradientFrom',
    'gradientTo',
    'outerStroke',
  ];
  return (
    typeof value.text === 'string' &&
    value.text.length <= 500 &&
    stringFields.every((key) => shortString(value[key], key === 'fontFamily' ? 200 : 100)) &&
    numericFields.every(([key, min, max]) => finiteBetween(value[key], min, max)) &&
    ['left', 'center', 'right'].includes(String(value.align)) &&
    [
      'basic', 'yt-bold', 'comic', 'neon', 'chrome', 'gradient', 'extrude-3d', 'bevel',
      'stack-shadow', 'retro', 'editorial', 'film-credits', 'soft-lume', 'glass',
      'ghost-overlap', 'foil-gold', 'foil-silver',
    ].includes(String(value.effect))
  );
}

function uniqueLayerIds(layers: Layer[]): void {
  const ids = new Set<string>();
  for (const layer of layers) {
    if (ids.has(layer.id)) throw new Error('Layer IDs must be unique');
    ids.add(layer.id);
  }
}

function integerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function finiteBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function shortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
