import type {
  BackgroundVariantKind,
  LayerRole,
  SlotFit,
  SlotKind,
  SlotMeta,
  TextEffect,
} from '../types/document';

export type ThumbnailSizeId = 'youtube-4k' | 'youtube-1080' | 'youtube-720';

export interface ThumbnailSize {
  id: ThumbnailSizeId;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  recommended?: boolean;
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateImageSlot {
  id: string;
  label: string;
  kind: Exclude<SlotKind, 'title'>;
  role: LayerRole;
  box: NormalizedBox;
  fit: SlotFit;
  cutout?: boolean;
  outline?: boolean;
  shape?: 'frame' | 'portrait' | 'circle';
}

export interface TemplateTitleSlot {
  id: string;
  label: string;
  kind: 'title';
  box: NormalizedBox;
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  fontSize: number;
  effect: TextEffect;
  text: string;
}

export interface ThumbnailTemplate {
  id: string;
  name: string;
  description: string;
  background: BackgroundVariantKind;
  title: TemplateTitleSlot;
  slots: TemplateImageSlot[];
}

export const THUMBNAIL_SIZES: readonly ThumbnailSize[] = [
  {
    id: 'youtube-4k',
    label: '4K · 3840×2160',
    shortLabel: '4K',
    width: 3840,
    height: 2160,
    recommended: true,
  },
  {
    id: 'youtube-1080',
    label: '1080p · 1920×1080',
    shortLabel: '1080p',
    width: 1920,
    height: 1080,
  },
  {
    id: 'youtube-720',
    label: '720p · 1280×720',
    shortLabel: '720p',
    width: 1280,
    height: 720,
  },
] as const;

const backgroundSlot = (): TemplateImageSlot => ({
  id: 'background',
  label: 'Background',
  kind: 'background',
  role: 'background',
  box: { x: 0, y: 0, width: 1, height: 1 },
  fit: 'cover',
  shape: 'frame',
});

export const THUMBNAIL_TEMPLATES: readonly ThumbnailTemplate[] = [
  {
    id: 'split-spotlight',
    name: 'Split spotlight',
    description: 'Face left, story image right, headline across the lower third.',
    background: 'panels',
    title: {
      id: 'title',
      label: 'Headline',
      kind: 'title',
      box: { x: 0.08, y: 0.7, width: 0.84, height: 0.22 },
      x: 0.5,
      y: 0.81,
      align: 'center',
      fontSize: 0.13,
      effect: 'yt-bold',
      text: 'MAKE IT CLICK',
    },
    slots: [
      backgroundSlot(),
      {
        id: 'support-main',
        label: 'Story image',
        kind: 'support',
        role: 'support',
        box: { x: 0.57, y: 0.08, width: 0.39, height: 0.62 },
        fit: 'contain',
        shape: 'frame',
      },
      {
        id: 'support-badge',
        label: 'Badge image',
        kind: 'support',
        role: 'support',
        box: { x: 0.78, y: 0.06, width: 0.16, height: 0.2 },
        fit: 'contain',
        cutout: true,
        shape: 'circle',
      },
      {
        id: 'subject',
        label: 'Person / subject',
        kind: 'subject',
        role: 'subject',
        box: { x: 0.01, y: 0.05, width: 0.54, height: 0.9 },
        fit: 'contain',
        cutout: true,
        outline: true,
        shape: 'portrait',
      },
    ],
  },
  {
    id: 'headline-left',
    name: 'Headline left',
    description: 'Large type on the left with a full-height subject on the right.',
    background: 'wash',
    title: {
      id: 'title',
      label: 'Headline',
      kind: 'title',
      box: { x: 0.06, y: 0.18, width: 0.48, height: 0.42 },
      x: 0.07,
      y: 0.38,
      align: 'left',
      fontSize: 0.145,
      effect: 'stack-shadow',
      text: 'WORTH THE HYPE?',
    },
    slots: [
      backgroundSlot(),
      {
        id: 'support-main',
        label: 'Context image',
        kind: 'support',
        role: 'support',
        box: { x: 0.04, y: 0.62, width: 0.35, height: 0.28 },
        fit: 'contain',
        shape: 'frame',
      },
      {
        id: 'support-badge',
        label: 'Logo / badge',
        kind: 'support',
        role: 'support',
        box: { x: 0.42, y: 0.65, width: 0.14, height: 0.2 },
        fit: 'contain',
        cutout: true,
        shape: 'circle',
      },
      {
        id: 'subject',
        label: 'Person / subject',
        kind: 'subject',
        role: 'subject',
        box: { x: 0.48, y: 0.03, width: 0.51, height: 0.96 },
        fit: 'contain',
        cutout: true,
        outline: true,
        shape: 'portrait',
      },
    ],
  },
  {
    id: 'center-stage',
    name: 'Center stage',
    description: 'Hero in the middle with supporting details framing both sides.',
    background: 'radial',
    title: {
      id: 'title',
      label: 'Headline',
      kind: 'title',
      box: { x: 0.13, y: 0.03, width: 0.74, height: 0.2 },
      x: 0.5,
      y: 0.13,
      align: 'center',
      fontSize: 0.12,
      effect: 'extrude-3d',
      text: 'THE BIG REVEAL',
    },
    slots: [
      backgroundSlot(),
      {
        id: 'support-left',
        label: 'Left detail',
        kind: 'support',
        role: 'support',
        box: { x: 0.03, y: 0.29, width: 0.28, height: 0.48 },
        fit: 'contain',
        shape: 'frame',
      },
      {
        id: 'support-right',
        label: 'Right detail',
        kind: 'support',
        role: 'support',
        box: { x: 0.69, y: 0.29, width: 0.28, height: 0.48 },
        fit: 'contain',
        shape: 'frame',
      },
      {
        id: 'subject',
        label: 'Person / subject',
        kind: 'subject',
        role: 'subject',
        box: { x: 0.27, y: 0.16, width: 0.46, height: 0.84 },
        fit: 'contain',
        cutout: true,
        outline: true,
        shape: 'portrait',
      },
    ],
  },
  {
    id: 'versus',
    name: 'Versus',
    description: 'Two opposing images, a central reaction, and a decisive top line.',
    background: 'split',
    title: {
      id: 'title',
      label: 'Headline',
      kind: 'title',
      box: { x: 0.11, y: 0.03, width: 0.78, height: 0.2 },
      x: 0.5,
      y: 0.13,
      align: 'center',
      fontSize: 0.12,
      effect: 'comic',
      text: 'WHICH ONE WINS?',
    },
    slots: [
      backgroundSlot(),
      {
        id: 'support-left',
        label: 'Left contender',
        kind: 'support',
        role: 'support',
        box: { x: 0.02, y: 0.23, width: 0.4, height: 0.69 },
        fit: 'contain',
        cutout: true,
        shape: 'frame',
      },
      {
        id: 'support-right',
        label: 'Right contender',
        kind: 'support',
        role: 'support',
        box: { x: 0.58, y: 0.23, width: 0.4, height: 0.69 },
        fit: 'contain',
        cutout: true,
        shape: 'frame',
      },
      {
        id: 'subject',
        label: 'Reaction / subject',
        kind: 'subject',
        role: 'subject',
        box: { x: 0.33, y: 0.36, width: 0.34, height: 0.63 },
        fit: 'contain',
        cutout: true,
        outline: true,
        shape: 'portrait',
      },
      {
        id: 'support-badge',
        label: 'Versus badge',
        kind: 'support',
        role: 'support',
        box: { x: 0.44, y: 0.42, width: 0.12, height: 0.18 },
        fit: 'contain',
        cutout: true,
        shape: 'circle',
      },
    ],
  },
  {
    id: 'product-punch',
    name: 'Product punch',
    description: 'Big product, expressive presenter, and room for a compact promise.',
    background: 'punch',
    title: {
      id: 'title',
      label: 'Headline',
      kind: 'title',
      box: { x: 0.05, y: 0.1, width: 0.5, height: 0.32 },
      x: 0.06,
      y: 0.26,
      align: 'left',
      fontSize: 0.135,
      effect: 'yt-bold',
      text: 'MY NEW FAVOURITE',
    },
    slots: [
      backgroundSlot(),
      {
        id: 'support-main',
        label: 'Product / result',
        kind: 'support',
        role: 'support',
        box: { x: 0.05, y: 0.43, width: 0.46, height: 0.51 },
        fit: 'contain',
        cutout: true,
        outline: true,
        shape: 'frame',
      },
      {
        id: 'support-badge',
        label: 'Brand / detail',
        kind: 'support',
        role: 'support',
        box: { x: 0.43, y: 0.08, width: 0.15, height: 0.2 },
        fit: 'contain',
        cutout: true,
        shape: 'circle',
      },
      {
        id: 'subject',
        label: 'Person / subject',
        kind: 'subject',
        role: 'subject',
        box: { x: 0.5, y: 0.04, width: 0.49, height: 0.95 },
        fit: 'contain',
        cutout: true,
        outline: true,
        shape: 'portrait',
      },
    ],
  },
  {
    id: 'triple-stack',
    name: 'Triple stack',
    description: 'A central host and three reusable story images for episodic content.',
    background: 'linear',
    title: {
      id: 'title',
      label: 'Headline',
      kind: 'title',
      box: { x: 0.08, y: 0.72, width: 0.84, height: 0.22 },
      x: 0.5,
      y: 0.83,
      align: 'center',
      fontSize: 0.12,
      effect: 'retro',
      text: 'THREE THINGS CHANGED',
    },
    slots: [
      backgroundSlot(),
      {
        id: 'support-left',
        label: 'Left story image',
        kind: 'support',
        role: 'support',
        box: { x: 0.02, y: 0.12, width: 0.3, height: 0.54 },
        fit: 'contain',
        shape: 'frame',
      },
      {
        id: 'support-right',
        label: 'Right story image',
        kind: 'support',
        role: 'support',
        box: { x: 0.68, y: 0.12, width: 0.3, height: 0.54 },
        fit: 'contain',
        shape: 'frame',
      },
      {
        id: 'support-badge',
        label: 'Badge image',
        kind: 'support',
        role: 'support',
        box: { x: 0.79, y: 0.04, width: 0.16, height: 0.2 },
        fit: 'contain',
        cutout: true,
        shape: 'circle',
      },
      {
        id: 'subject',
        label: 'Person / subject',
        kind: 'subject',
        role: 'subject',
        box: { x: 0.29, y: 0.08, width: 0.42, height: 0.75 },
        fit: 'contain',
        cutout: true,
        outline: true,
        shape: 'portrait',
      },
    ],
  },
] as const;

export const DEFAULT_TEMPLATE_ID = THUMBNAIL_TEMPLATES[0].id;
export const DEFAULT_THUMBNAIL_SIZE_ID: ThumbnailSizeId = 'youtube-1080';
export const DEFAULT_EXPORT_SIZE_ID: ThumbnailSizeId = 'youtube-4k';

export function getThumbnailTemplate(id: string): ThumbnailTemplate {
  return THUMBNAIL_TEMPLATES.find((template) => template.id === id) ?? THUMBNAIL_TEMPLATES[0];
}

export function getThumbnailSize(id: ThumbnailSizeId | string): ThumbnailSize {
  return THUMBNAIL_SIZES.find((size) => size.id === id) ?? THUMBNAIL_SIZES[1];
}

export function scaleBox(box: NormalizedBox, width: number, height: number) {
  return {
    x: box.x * width,
    y: box.y * height,
    width: box.width * width,
    height: box.height * height,
  };
}

export function slotMeta(
  slot: TemplateImageSlot | TemplateTitleSlot,
  canvasWidth?: number,
): SlotMeta {
  return {
    id: slot.id,
    label: slot.label,
    kind: slot.kind,
    fit: 'fit' in slot ? slot.fit : 'contain',
    box: { ...slot.box },
    canvasWidth,
    cutout: 'cutout' in slot ? slot.cutout : false,
    outline: 'outline' in slot ? slot.outline : false,
  };
}

export function fitImageToBox(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  box: NormalizedBox,
  fit: SlotFit,
) {
  const target = scaleBox(box, canvasWidth, canvasHeight);
  const scaleX = target.width / Math.max(1, imageWidth);
  const scaleY = target.height / Math.max(1, imageHeight);
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: target.x + (target.width - width) / 2,
    y: target.y + (target.height - height) / 2,
    scaleX: scale,
    scaleY: scale,
    rotation: 0,
  };
}

export function isNormalizedBox(box: NormalizedBox): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= 1.000001 &&
    box.y + box.height <= 1.000001
  );
}

export function fitTitleFontSize(
  requestedSize: number,
  availableWidth: number,
  measuredWidth: number,
): number {
  if (measuredWidth <= 0 || measuredWidth <= availableWidth) return requestedSize;
  return requestedSize * (Math.max(0, availableWidth) / measuredWidth);
}
