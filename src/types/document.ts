export type LayerRole = 'background' | 'subject' | 'support' | 'text' | 'none';
export type BlendMode = 'normal' | 'multiply';
export type SlotKind = 'background' | 'subject' | 'support' | 'title';
export type SlotFit = 'contain' | 'cover';

export interface SlotMeta {
  id: string;
  label: string;
  kind: SlotKind;
  fit: SlotFit;
  /** Resolution-independent template bounds, expressed from 0..1. */
  box: { x: number; y: number; width: number; height: number };
  /** Current document width used to turn normalized title bounds into pixels. */
  canvasWidth?: number;
  cutout?: boolean;
  outline?: boolean;
}
export type Tool =
  | 'select'
  | 'transform'
  | 'text'
  | 'liquify-warp'
  | 'liquify-bloat'
  | 'liquify-pucker'
  | 'beauty'
  | 'erase'
  | 'crop';

export type BackgroundVariantKind =
  | 'solid'
  | 'split'
  | 'linear'
  | 'radial'
  | 'panels'
  | 'wash'
  | 'punch';

/** Visual text recipes — basic stays available; others are thumbnail-ready looks */
export type TextEffect =
  | 'basic'
  | 'yt-bold'
  | 'comic'
  | 'neon'
  | 'chrome'
  | 'gradient'
  | 'extrude-3d'
  | 'bevel'
  | 'stack-shadow'
  | 'retro'
  | 'editorial'
  | 'film-credits'
  | 'soft-lume'
  | 'glass'
  | 'ghost-overlap'
  | 'foil-gold'
  | 'foil-silver';

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface OutlineStyle {
  enabled: boolean;
  width: number;
  color: string;
}

export interface GradeSettings {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface BeautySettings {
  amount: number;
  smooth: number;
  eyes: number;
  teeth: number;
  underEye: number;
}

export interface BaseLayer {
  id: string;
  name: string;
  role: LayerRole;
  visible: boolean;
  opacity: number;
  locked: boolean;
  blendMode: BlendMode;
  /** Present when this layer can be replaced without changing template geometry. */
  slot?: SlotMeta;
}

export interface SlotLayer extends BaseLayer {
  type: 'slot';
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  transform: Transform;
  outline: OutlineStyle;
  grade: GradeSettings;
  beauty: BeautySettings;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  align: 'left' | 'center' | 'right';
  transform: Transform;
  /** Effect recipe */
  effect: TextEffect;
  /** 3D extrusion depth in px */
  extrudeDepth: number;
  /** Extrusion direction in degrees (0 = right, 90 = down) */
  extrudeAngle: number;
  extrudeColor: string;
  gradientFrom: string;
  gradientTo: string;
  /** Outer ring for comic / double outline */
  outerStroke: string;
  outerStrokeWidth: number;
  letterSpacing: number;
  /** Slight perspective skew for 3D feel (-0.3..0.3) */
  skewX: number;
}

export interface BackgroundLayer extends BaseLayer {
  type: 'background';
  variant: BackgroundVariantKind;
  seed: number;
  primary: string;
  accent: string;
  src: string;
}

export type Layer = ImageLayer | TextLayer | BackgroundLayer | SlotLayer;

/** One still in the animation strip — full layer snapshot */
export interface AnimFrame {
  id: string;
  layers: Layer[];
}

export interface DocumentState {
  id: string;
  name: string;
  width: number;
  height: number;
  transparent: boolean;
  /** Live edit buffer — always mirrors frames[activeFrameIndex].layers */
  layers: Layer[];
  selectedLayerId: string | null;
  showSafeGuides: boolean;
  /** Ordered frames for animation; length >= 1 */
  frames: AnimFrame[];
  activeFrameIndex: number;
  /** Playback / export frame rate */
  fps: number;
  templateId?: string;
  templateName?: string;
}

export interface BrandKit {
  primary: string;
  accent: string;
  textFill: string;
  textStroke: string;
  textStrokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  fontFamily: string;
  fontWeight: number;
  titleSize: number;
  subtitleSize: number;
  subjectOutlineColor: string;
  subjectOutlineWidth: number;
  defaultTextEffect: TextEffect;
}

export const DEFAULT_BRAND_KIT: BrandKit = {
  primary: '#18121f',
  accent: '#729488',
  textFill: '#f0ede6',
  textStroke: '#0e0b13',
  textStrokeWidth: 10,
  shadowColor: 'rgba(0,0,0,0.7)',
  shadowBlur: 16,
  fontFamily: '"Archivo Black", Impact, sans-serif',
  fontWeight: 400,
  titleSize: 100,
  subtitleSize: 48,
  subjectOutlineColor: '#f0ede6',
  subjectOutlineWidth: 14,
  defaultTextEffect: 'editorial',
};

export const DEFAULT_GRADE: GradeSettings = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

export const DEFAULT_BEAUTY: BeautySettings = {
  amount: 0,
  smooth: 0.5,
  eyes: 0.4,
  teeth: 0.3,
  underEye: 0.4,
};

export const DEFAULT_OUTLINE: OutlineStyle = {
  enabled: false,
  width: 14,
  color: '#f0ede6',
};

export function createTransform(
  x = 0,
  y = 0,
  scale = 1,
): Transform {
  return { x, y, scaleX: scale, scaleY: scale, rotation: 0 };
}

export function defaultTextEffects(): Pick<
  TextLayer,
  | 'effect'
  | 'extrudeDepth'
  | 'extrudeAngle'
  | 'extrudeColor'
  | 'gradientFrom'
  | 'gradientTo'
  | 'outerStroke'
  | 'outerStrokeWidth'
  | 'letterSpacing'
  | 'skewX'
> {
  return {
    effect: 'yt-bold',
    extrudeDepth: 14,
    extrudeAngle: 225,
    extrudeColor: '#1a1208',
    gradientFrom: '#fff6d8',
    gradientTo: '#b89c67',
    outerStroke: '#f0ede6',
    outerStrokeWidth: 6,
    letterSpacing: 0,
    skewX: 0,
  };
}
