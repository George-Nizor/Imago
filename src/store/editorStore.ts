import { create } from 'zustand';
import {
  type BrandKit,
  type DocumentState,
  type AnimFrame,
  type ImageLayer,
  type Layer,
  type LayerRole,
  type SlotLayer,
  type TextLayer,
  type Tool,
  type BackgroundVariantKind,
  type BackgroundLayer,
  DEFAULT_BRAND_KIT,
  DEFAULT_BEAUTY,
  DEFAULT_GRADE,
  DEFAULT_OUTLINE,
  createTransform,
  defaultTextEffects,
} from '../types/document';
import { uid } from '../lib/id';
import { renderBackground, nextSeed } from '../lib/backgrounds';
import { centerTransform, fileToDataUrl, loadImage } from '../lib/imageUtils';
import { applyTextPreset } from '../lib/textEffects';
import { removeBackgroundFromSrc } from '../lib/cutout';
import {
  saveSubjectCutout,
  touchSubjectCutout,
  type StoredSubjectCutout,
} from '../lib/subjectLibrary';
import {
  makeErrorNotice,
  makeNotice,
  reportDiagnostic,
  type AppNotice,
} from '../lib/diagnostics';
import {
  DEFAULT_TEMPLATE_ID,
  DEFAULT_THUMBNAIL_SIZE_ID,
  fitImageToBox,
  getThumbnailSize,
  getThumbnailTemplate,
  slotMeta,
  type ThumbnailSizeId,
} from '../lib/templates';

const MAX_HISTORY = 40;
const MAX_FRAMES = 48;

interface EditorStore {
  doc: DocumentState | null;
  tool: Tool;
  brushSize: number;
  brushStrength: number;
  eraseSoft: boolean;
  busy: string | null;
  notice: AppNotice | null;
  past: DocumentState[];
  future: DocumentState[];
  stageScale: number;
  stagePos: { x: number; y: number };
  playing: boolean;

  setTool: (t: Tool) => void;
  setBrushSize: (n: number) => void;
  setBrushStrength: (n: number) => void;
  setEraseSoft: (v: boolean) => void;
  setBusy: (msg: string | null) => void;
  setNotice: (notice: AppNotice | null) => void;
  setStageView: (scale: number, pos: { x: number; y: number }) => void;
  setPlaying: (v: boolean) => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  newThumbnail: (brand: BrandKit) => void;
  newThumbnailFromTemplate: (
    templateId: string,
    brand: BrandKit,
    sizeId?: ThumbnailSizeId,
  ) => void;
  newTitleCard: (brand: BrandKit) => void;
  closeDoc: () => void;
  loadDocument: (document: DocumentState) => void;
  setDocName: (name: string) => void;

  selectLayer: (id: string | null) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  setLayerRole: (id: string, role: LayerRole) => void;
  reorderLayer: (from: number, to: number) => void;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  toggleVisibility: (id: string) => void;

  addImageFromFile: (file: File, role?: LayerRole, brand?: BrandKit) => Promise<string>;
  replaceSlotFromFile: (slotId: string, file: File, brand?: BrandKit) => Promise<string>;
  replaceSubjectSlotFromLibrary: (
    slotId: string,
    cutout: StoredSubjectCutout,
    brand?: BrandKit,
  ) => Promise<string>;
  addTextLayer: (brand: BrandKit, text?: string) => string;
  rerollBackground: (brand: BrandKit, variant?: BackgroundVariantKind) => void;
  setBackgroundVariant: (variant: BackgroundVariantKind, brand: BrandKit) => void;

  replaceImageSrc: (id: string, src: string, dims?: { w: number; h: number }) => void;
  applyBrandToDoc: (brand: BrandKit) => void;

  selectFrame: (index: number) => void;
  addFrame: () => void;
  duplicateFrame: (index?: number) => void;
  deleteFrame: (index?: number) => void;
  moveFrame: (from: number, to: number) => void;
  setFps: (fps: number) => void;
  stepFrame: (delta: number) => void;
}

function cloneDoc(doc: DocumentState): DocumentState {
  return structuredClone(doc);
}

/** Write layers into the active frame slot and return updated doc. */
function withLayers(
  doc: DocumentState,
  layers: Layer[],
  extra: Partial<DocumentState> = {},
): DocumentState {
  const idx = Math.max(0, Math.min(doc.activeFrameIndex, Math.max(0, doc.frames.length - 1)));
  const frames =
    doc.frames.length === 0
      ? [{ id: uid('frm'), layers: structuredClone(layers) }]
      : doc.frames.map((f, i) => (i === idx ? { ...f, layers: structuredClone(layers) } : f));
  return {
    ...doc,
    ...extra,
    layers,
    frames,
    activeFrameIndex: Math.min(idx, frames.length - 1),
  };
}

function makeBackground(
  width: number,
  height: number,
  brand: BrandKit,
  variant: BackgroundVariantKind = 'panels',
  seed = Date.now() % 100000,
): BackgroundLayer {
  const src = renderBackground(width, height, variant, brand.primary, brand.accent, seed);
  return {
    id: uid('bg'),
    type: 'background',
    name: 'Background',
    role: 'background',
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal',
    variant,
    seed,
    primary: brand.primary,
    accent: brand.accent,
    src,
  };
}

function emptyDoc(
  name: string,
  width: number,
  height: number,
  transparent: boolean,
  layers: Layer[],
  extra: Partial<DocumentState> = {},
): DocumentState {
  const frame: AnimFrame = { id: uid('frm'), layers: structuredClone(layers) };
  return {
    id: uid('doc'),
    name,
    width,
    height,
    transparent,
    layers,
    selectedLayerId: layers[layers.length - 1]?.id ?? null,
    showSafeGuides: !transparent && width === 1280,
    frames: [frame],
    activeFrameIndex: 0,
    fps: 8,
    ...extra,
  };
}

function templateDocument(templateId: string, sizeId: ThumbnailSizeId, brand: BrandKit) {
  const template = getThumbnailTemplate(templateId);
  const { width, height } = getThumbnailSize(sizeId);
  const scale = height / 720;
  const backgroundDefinition = template.slots.find((slot) => slot.kind === 'background');
  const background = makeBackground(width, height, brand, template.background);
  if (backgroundDefinition) background.slot = slotMeta(backgroundDefinition);

  const placeholders: SlotLayer[] = template.slots
    .filter((slot) => slot.kind !== 'background')
    .map((slot) => ({
      id: uid('slot'),
      type: 'slot',
      name: slot.label,
      role: slot.role,
      visible: true,
      opacity: 1,
      locked: true,
      blendMode: 'normal',
      slot: slotMeta(slot),
    }));

  const titleBase: TextLayer = {
    id: uid('txt'),
    type: 'text',
    name: template.title.label,
    role: 'text',
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal',
    slot: slotMeta(template.title, width),
    text: template.title.text,
    fontFamily: brand.fontFamily,
    fontSize: Math.round(height * template.title.fontSize),
    fontWeight: brand.fontWeight,
    fill: brand.textFill,
    stroke: brand.textStroke,
    strokeWidth: Math.max(2, Math.round(brand.textStrokeWidth * scale)),
    shadowColor: brand.shadowColor,
    shadowBlur: Math.round(brand.shadowBlur * scale),
    shadowOffsetX: Math.round(4 * scale),
    shadowOffsetY: Math.round(4 * scale),
    align: template.title.align,
    transform: createTransform(width * template.title.x, height * template.title.y),
    ...defaultTextEffects(),
  };
  const title: TextLayer = {
    ...titleBase,
    ...applyTextPreset(template.title.effect, titleBase),
    effect: template.title.effect,
  };
  const layers: Layer[] = [background, ...placeholders, title];
  const firstReplaceable = placeholders.find((layer) => layer.role === 'subject') ?? placeholders[0];
  return emptyDoc(template.name, width, height, false, layers, {
    templateId: template.id,
    templateName: template.name,
    selectedLayerId: firstReplaceable?.id ?? title.id,
  });
}

function makeSlotImageLayer(
  doc: DocumentState,
  target: Layer,
  src: string,
  naturalWidth: number,
  naturalHeight: number,
  brand: BrandKit,
): ImageLayer {
  const slot = target.slot;
  if (!slot || slot.kind === 'title') throw new Error('Image slot not found');
  const scale = doc.height / 720;
  return {
    id: target.id,
    type: 'image',
    name: slot.label,
    role: slot.kind === 'background' ? 'background' : target.role,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal',
    slot,
    src,
    naturalWidth,
    naturalHeight,
    transform: fitImageToBox(
      naturalWidth,
      naturalHeight,
      doc.width,
      doc.height,
      slot.box,
      slot.fit,
    ),
    outline: {
      ...DEFAULT_OUTLINE,
      enabled: Boolean(slot.outline),
      width: Math.max(2, Math.round(brand.subjectOutlineWidth * scale)),
      color: brand.subjectOutlineColor,
    },
    grade: { ...DEFAULT_GRADE },
    beauty: { ...DEFAULT_BEAUTY },
  };
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  doc: null,
  tool: 'select',
  brushSize: 60,
  brushStrength: 0.55,
  eraseSoft: true,
  busy: null,
  notice: null,
  past: [],
  future: [],
  stageScale: 0.55,
  stagePos: { x: 40, y: 40 },
  playing: false,

  setTool: (t) => set({ tool: t }),
  setBrushSize: (n) => set({ brushSize: n }),
  setBrushStrength: (n) => set({ brushStrength: n }),
  setEraseSoft: (v) => set({ eraseSoft: v }),
  setBusy: (msg) => set({ busy: msg }),
  setNotice: (notice) => set({ notice }),
  setStageView: (scale, pos) => set({ stageScale: scale, stagePos: pos }),
  setPlaying: (v) => set({ playing: v }),

  pushHistory: () => {
    const { doc, past } = get();
    if (!doc) return;
    set({
      past: [...past.slice(-(MAX_HISTORY - 1)), cloneDoc(doc)],
      future: [],
    });
  },

  undo: () => {
    const { past, doc, future } = get();
    if (!doc || past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [cloneDoc(doc), ...future].slice(0, MAX_HISTORY),
      doc: prev,
      playing: false,
    });
  },

  redo: () => {
    const { future, doc, past } = get();
    if (!doc || future.length === 0) return;
    const next = future[0];
    set({
      future: future.slice(1),
      past: [...past, cloneDoc(doc)].slice(-MAX_HISTORY),
      doc: next,
      playing: false,
    });
  },

  newThumbnail: (brand) => {
    get().newThumbnailFromTemplate(DEFAULT_TEMPLATE_ID, brand, DEFAULT_THUMBNAIL_SIZE_ID);
  },

  newThumbnailFromTemplate: (templateId, brand, sizeId = DEFAULT_THUMBNAIL_SIZE_ID) => {
    set({
      doc: templateDocument(templateId, sizeId, brand),
      past: [],
      future: [],
      tool: 'select',
      stageScale: 1,
      stagePos: { x: 0, y: 0 },
      playing: false,
      notice: null,
    });
  },

  newTitleCard: (brand) => {
    const width = 1920;
    const height = 1080;
    const textBase: TextLayer = {
      id: uid('txt'),
      type: 'text',
      name: 'Title',
      role: 'text',
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'normal',
      text: 'TITLE CARD',
      fontFamily: brand.fontFamily,
      fontSize: Math.round(brand.titleSize * 1.2),
      fontWeight: brand.fontWeight,
      fill: brand.textFill,
      stroke: brand.textStroke,
      strokeWidth: brand.textStrokeWidth,
      shadowColor: brand.shadowColor,
      shadowBlur: brand.shadowBlur,
      shadowOffsetX: 4,
      shadowOffsetY: 4,
      align: 'center',
      transform: createTransform(width / 2, height / 2),
      ...defaultTextEffects(),
    };
    const text: TextLayer = {
      ...textBase,
      ...applyTextPreset(brand.defaultTextEffect ?? 'editorial', textBase),
      effect: brand.defaultTextEffect ?? 'editorial',
    };
    set({
      doc: emptyDoc('Title Card', width, height, true, [text]),
      past: [],
      future: [],
      tool: 'text',
      stageScale: 0.4,
      stagePos: { x: 40, y: 40 },
      playing: false,
      notice: null,
    });
  },

  closeDoc: () => set({ doc: null, past: [], future: [], playing: false, notice: null }),
  loadDocument: (document) =>
    set({
      doc: structuredClone(document),
      past: [],
      future: [],
      tool: 'select',
      stageScale: 1,
      stagePos: { x: 0, y: 0 },
      playing: false,
      notice: makeNotice('success', 'MCP document opened.', 'All embedded layers remain editable.'),
    }),
  setDocName: (name) => {
    const { doc } = get();
    if (!doc) return;
    set({ doc: { ...doc, name } });
  },

  selectLayer: (id) => {
    const { doc } = get();
    if (!doc) return;
    set({ doc: { ...doc, selectedLayerId: id } });
  },

  updateLayer: (id, patch) => {
    const { doc } = get();
    if (!doc) return;
    const layers = doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l));
    set({ doc: withLayers(doc, layers) });
  },

  setLayerRole: (id, role) => {
    get().pushHistory();
    get().updateLayer(id, { role, name: roleLabel(role) });
  },

  reorderLayer: (from, to) => {
    const { doc } = get();
    if (!doc) return;
    if (doc.layers[from]?.slot || doc.layers[to]?.slot) return;
    get().pushHistory();
    const layers = [...doc.layers];
    const [item] = layers.splice(from, 1);
    layers.splice(to, 0, item);
    set({ doc: withLayers(doc, layers) });
  },

  deleteLayer: (id) => {
    const { doc } = get();
    if (!doc) return;
    if (doc.layers.find((layer) => layer.id === id)?.slot) return;
    get().pushHistory();
    const layers = doc.layers.filter((l) => l.id !== id);
    set({
      doc: withLayers(doc, layers, {
        selectedLayerId:
          doc.selectedLayerId === id ? layers[layers.length - 1]?.id ?? null : doc.selectedLayerId,
      }),
    });
  },

  duplicateLayer: (id) => {
    const { doc } = get();
    if (!doc) return;
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer || layer.slot) return;
    get().pushHistory();
    const copy = structuredClone(layer);
    copy.id = uid(layer.type === 'text' ? 'txt' : 'img');
    copy.name = `${layer.name} copy`;
    if (copy.type !== 'background' && 'transform' in copy) {
      copy.transform = { ...copy.transform, x: copy.transform.x + 20, y: copy.transform.y + 20 };
    }
    const idx = doc.layers.findIndex((l) => l.id === id);
    const layers = [...doc.layers];
    layers.splice(idx + 1, 0, copy);
    set({ doc: withLayers(doc, layers, { selectedLayerId: copy.id }) });
  },

  toggleVisibility: (id) => {
    const { doc } = get();
    if (!doc) return;
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    get().updateLayer(id, { visible: !layer.visible });
  },

  addImageFromFile: async (file, role = 'support', brand = DEFAULT_BRAND_KIT) => {
    const { doc } = get();
    if (!doc) throw new Error('No document');
    get().pushHistory();
    const src = await fileToDataUrl(file);
    const img = await loadImage(src);
    const isSubject = role === 'subject';
    const transform = centerTransform(
      img.naturalWidth,
      img.naturalHeight,
      doc.width,
      doc.height,
      'fit',
    );
    if (!isSubject) {
      transform.scaleX *= 0.45;
      transform.scaleY *= 0.45;
      transform.x = doc.width * 0.08;
      transform.y = doc.height * 0.2;
    } else {
      transform.scaleX *= 0.85;
      transform.scaleY *= 0.85;
      transform.x = (doc.width - img.naturalWidth * transform.scaleX) / 2;
      transform.y = (doc.height - img.naturalHeight * transform.scaleY) / 2 + doc.height * 0.05;
    }

    const layer: ImageLayer = {
      id: uid('img'),
      type: 'image',
      name: isSubject ? 'Subject' : 'Support',
      role,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'normal',
      src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      transform,
      outline: {
        ...DEFAULT_OUTLINE,
        enabled: isSubject,
        width: brand.subjectOutlineWidth,
        color: brand.subjectOutlineColor,
      },
      grade: { ...DEFAULT_GRADE },
      beauty: { ...DEFAULT_BEAUTY },
    };

    const layers = [...doc.layers];
    const textIdx = layers.findIndex((l) => l.role === 'text');
    const insertAt = textIdx >= 0 ? textIdx : layers.length;
    layers.splice(insertAt, 0, layer);
    set({ doc: withLayers(doc, layers, { selectedLayerId: layer.id }) });
    return layer.id;
  },

  replaceSlotFromFile: async (slotId, file, brand = DEFAULT_BRAND_KIT) => {
    const initialDoc = get().doc;
    const target = initialDoc?.layers.find((layer) => layer.slot?.id === slotId);
    const slot = target?.slot;
    if (!initialDoc || !target || !slot || slot.kind === 'title') {
      throw new Error(`Image slot not found: ${slotId}`);
    }

    get().pushHistory();
    const src = await fileToDataUrl(file);
    const image = await loadImage(src);
    const replacement = makeSlotImageLayer(
      initialDoc,
      target,
      src,
      image.naturalWidth,
      image.naturalHeight,
      brand,
    );

    const currentDoc = get().doc;
    if (!currentDoc || currentDoc.id !== initialDoc.id) throw new Error('Document changed');
    set({
      doc: withLayers(
        currentDoc,
        currentDoc.layers.map((layer) => (layer.id === target.id ? replacement : layer)),
        { selectedLayerId: target.id },
      ),
    });

    if (slot.cutout) {
      get().setBusy(`Isolating ${slot.label.toLowerCase()}…`);
      try {
        const cutoutSrc = await removeBackgroundFromSrc(src, (percent) => {
          get().setBusy(`Preparing cutout AI · ${percent}%`);
        });
        const cutout = await loadImage(cutoutSrc);
        const activeLayer = get().doc?.layers.find((layer) => layer.id === target.id);
        if (
          get().doc?.id !== initialDoc.id ||
          activeLayer?.type !== 'image' ||
          activeLayer.src !== src
        ) {
          URL.revokeObjectURL(cutoutSrc);
          return target.id;
        }
        const cutoutTransform = fitImageToBox(
          cutout.naturalWidth,
          cutout.naturalHeight,
          initialDoc.width,
          initialDoc.height,
          slot.box,
          slot.fit,
        );
        get().replaceImageSrc(target.id, cutoutSrc, {
          w: cutout.naturalWidth,
          h: cutout.naturalHeight,
        });
        get().updateLayer(target.id, { transform: cutoutTransform });

        if (slot.kind === 'subject') {
          try {
            const cutoutBlob = await (await fetch(cutoutSrc)).blob();
            await saveSubjectCutout({
              blob: cutoutBlob,
              name: file.name,
              naturalWidth: cutout.naturalWidth,
              naturalHeight: cutout.naturalHeight,
            });
          } catch (error) {
            reportDiagnostic('storage', error);
          }
        }
      } catch (error) {
        reportDiagnostic('cutout', error);
        get().setNotice(
          makeErrorNotice(
            'cutout',
            'Automatic cutout was unavailable.',
            'The original image was placed and can still be edited.',
          ),
        );
      } finally {
        get().setBusy(null);
      }
    }
    return target.id;
  },

  replaceSubjectSlotFromLibrary: async (slotId, cutout, brand = DEFAULT_BRAND_KIT) => {
    const initialDoc = get().doc;
    const target = initialDoc?.layers.find((layer) => layer.slot?.id === slotId);
    if (!initialDoc || !target?.slot || target.slot.kind !== 'subject') {
      throw new Error(`Subject slot not found: ${slotId}`);
    }
    if (!(cutout.blob instanceof Blob)) throw new Error('Reusable subject is invalid');

    const src = URL.createObjectURL(cutout.blob);
    try {
      const image = await loadImage(src);
      const replacement = makeSlotImageLayer(
        initialDoc,
        target,
        src,
        image.naturalWidth,
        image.naturalHeight,
        brand,
      );
      const currentDoc = get().doc;
      if (!currentDoc || currentDoc.id !== initialDoc.id) throw new Error('Document changed');
      get().pushHistory();
      set({
        doc: withLayers(
          currentDoc,
          currentDoc.layers.map((layer) => (layer.id === target.id ? replacement : layer)),
          { selectedLayerId: target.id },
        ),
      });
      await touchSubjectCutout(cutout.id).catch((error) => {
        reportDiagnostic('storage', error);
      });
      return target.id;
    } catch (error) {
      URL.revokeObjectURL(src);
      throw error;
    }
  },

  addTextLayer: (brand, text = 'Text') => {
    const { doc } = get();
    if (!doc) throw new Error('No document');
    get().pushHistory();
    const layerBase: TextLayer = {
      id: uid('txt'),
      type: 'text',
      name: 'Text',
      role: 'text',
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'normal',
      text,
      fontFamily: brand.fontFamily,
      fontSize: brand.subtitleSize,
      fontWeight: brand.fontWeight,
      fill: brand.textFill,
      stroke: brand.textStroke,
      strokeWidth: Math.max(2, brand.textStrokeWidth / 2),
      shadowColor: brand.shadowColor,
      shadowBlur: brand.shadowBlur,
      shadowOffsetX: 3,
      shadowOffsetY: 3,
      align: 'center',
      transform: createTransform(doc.width / 2, doc.height * 0.5),
      ...defaultTextEffects(),
    };
    const layer: TextLayer = {
      ...layerBase,
      ...applyTextPreset(brand.defaultTextEffect ?? 'basic', layerBase),
      effect: brand.defaultTextEffect ?? 'basic',
    };
    set({
      doc: withLayers(doc, [...doc.layers, layer], { selectedLayerId: layer.id }),
      tool: 'text',
    });
    return layer.id;
  },

  rerollBackground: (brand, variant) => {
    const { doc } = get();
    if (!doc) return;
    get().pushHistory();
    const layers = doc.layers.map((l) => {
      if (l.slot?.kind === 'background' && l.type !== 'background') {
        const next = makeBackground(doc.width, doc.height, brand, variant ?? 'panels');
        return { ...next, id: l.id, slot: l.slot };
      }
      if (l.type !== 'background') return l;
      const v = variant ?? l.variant;
      const seed = nextSeed(l.seed);
      return {
        ...l,
        variant: v,
        seed,
        primary: brand.primary,
        accent: brand.accent,
        src: renderBackground(doc.width, doc.height, v, brand.primary, brand.accent, seed),
      };
    });
    if (!layers.some((l) => l.type === 'background') && !doc.transparent) {
      layers.unshift(makeBackground(doc.width, doc.height, brand, variant ?? 'panels'));
    }
    set({ doc: withLayers(doc, layers) });
  },

  setBackgroundVariant: (variant, brand) => {
    get().rerollBackground(brand, variant);
  },

  replaceImageSrc: (id, src, dims) => {
    const { doc } = get();
    if (!doc) return;
    const layers = doc.layers.map((l) => {
      if (l.id !== id || l.type !== 'image') return l;
      return {
        ...l,
        src,
        naturalWidth: dims?.w ?? l.naturalWidth,
        naturalHeight: dims?.h ?? l.naturalHeight,
      };
    });
    set({ doc: withLayers(doc, layers) });
  },

  applyBrandToDoc: (brand) => {
    const { doc } = get();
    if (!doc) return;
    get().pushHistory();
    const layers = doc.layers.map((l) => {
      if (l.type === 'text') {
        return {
          ...l,
          fontFamily: brand.fontFamily,
          fontWeight: brand.fontWeight,
          fill: brand.textFill,
          stroke: brand.textStroke,
          strokeWidth:
            l.name === 'Title' ? brand.textStrokeWidth : Math.max(2, brand.textStrokeWidth / 2),
          shadowColor: brand.shadowColor,
          shadowBlur: brand.shadowBlur,
          fontSize: l.name === 'Title' ? brand.titleSize : l.fontSize,
        };
      }
      if (l.type === 'image' && l.role === 'subject') {
        return {
          ...l,
          outline: {
            ...l.outline,
            color: brand.subjectOutlineColor,
            width: brand.subjectOutlineWidth,
          },
        };
      }
      if (l.type === 'background') {
        return {
          ...l,
          primary: brand.primary,
          accent: brand.accent,
          src: renderBackground(doc.width, doc.height, l.variant, brand.primary, brand.accent, l.seed),
        };
      }
      return l;
    });
    set({ doc: withLayers(doc, layers) });
  },

  selectFrame: (index) => {
    const { doc } = get();
    if (!doc || doc.frames.length === 0) return;
    const i = Math.max(0, Math.min(index, doc.frames.length - 1));
    if (i === doc.activeFrameIndex) return;
    const flushed = withLayers(doc, doc.layers);
    const layers = structuredClone(flushed.frames[i].layers);
    set({
      doc: {
        ...flushed,
        layers,
        activeFrameIndex: i,
        selectedLayerId: layers[layers.length - 1]?.id ?? null,
      },
    });
  },

  addFrame: () => {
    get().duplicateFrame();
  },

  duplicateFrame: (index) => {
    const { doc } = get();
    if (!doc) return;
    if (doc.frames.length >= MAX_FRAMES) {
      set({
        notice: makeNotice(
          'info',
          `This animation already has ${MAX_FRAMES} frames.`,
          'Delete a frame before adding another.',
        ),
      });
      return;
    }
    get().pushHistory();
    const flushed = withLayers(doc, doc.layers);
    const srcIdx = index ?? flushed.activeFrameIndex;
    const source = flushed.frames[srcIdx];
    const copy: AnimFrame = {
      id: uid('frm'),
      layers: structuredClone(source.layers),
    };
    const frames = [...flushed.frames];
    frames.splice(srcIdx + 1, 0, copy);
    set({
      doc: {
        ...flushed,
        frames,
        activeFrameIndex: srcIdx + 1,
        layers: structuredClone(copy.layers),
        selectedLayerId: copy.layers[copy.layers.length - 1]?.id ?? null,
      },
      playing: false,
    });
  },

  deleteFrame: (index) => {
    const { doc } = get();
    if (!doc || doc.frames.length <= 1) return;
    get().pushHistory();
    const flushed = withLayers(doc, doc.layers);
    const removeAt = index ?? flushed.activeFrameIndex;
    const frames = flushed.frames.filter((_, i) => i !== removeAt);
    const nextIdx = Math.min(removeAt, frames.length - 1);
    set({
      doc: {
        ...flushed,
        frames,
        activeFrameIndex: nextIdx,
        layers: structuredClone(frames[nextIdx].layers),
        selectedLayerId: frames[nextIdx].layers[frames[nextIdx].layers.length - 1]?.id ?? null,
      },
      playing: false,
    });
  },

  moveFrame: (from, to) => {
    const { doc } = get();
    if (!doc) return;
    if (from === to || from < 0 || to < 0 || from >= doc.frames.length || to >= doc.frames.length) {
      return;
    }
    get().pushHistory();
    const flushed = withLayers(doc, doc.layers);
    const frames = [...flushed.frames];
    const [item] = frames.splice(from, 1);
    frames.splice(to, 0, item);
    let active = flushed.activeFrameIndex;
    if (active === from) active = to;
    else if (from < active && to >= active) active -= 1;
    else if (from > active && to <= active) active += 1;
    set({
      doc: {
        ...flushed,
        frames,
        activeFrameIndex: active,
        layers: structuredClone(frames[active].layers),
      },
      playing: false,
    });
  },

  setFps: (fps) => {
    const { doc } = get();
    if (!doc) return;
    set({ doc: { ...doc, fps: Math.max(1, Math.min(30, Math.round(fps))) } });
  },

  stepFrame: (delta) => {
    const { doc } = get();
    if (!doc || doc.frames.length === 0) return;
    const next = (doc.activeFrameIndex + delta + doc.frames.length) % doc.frames.length;
    get().selectFrame(next);
  },
}));

function roleLabel(role: LayerRole): string {
  switch (role) {
    case 'background':
      return 'Background';
    case 'subject':
      return 'Subject';
    case 'support':
      return 'Support';
    case 'text':
      return 'Text';
    default:
      return 'Layer';
  }
}

export function getSelectedLayer(doc: DocumentState | null): Layer | null {
  if (!doc || !doc.selectedLayerId) return null;
  return doc.layers.find((l) => l.id === doc.selectedLayerId) ?? null;
}
