export type PresetId = "thumbnail" | "photo" | "graphic";

export interface Size {
  width: number;
  height: number;
}
export interface AssetInfo {
  name: string;
  kind: "upload" | "cutout" | "stock" | "reference" | "kit" | "face" | "brand";
  /** A face copied in from the face pack. */
  faceId?: string;
  /** A brand file copied in at creation (`brand-<name>`): its kind (logo, mascot, other) and the owner's note. */
  brandKind?: BrandAssetKind;
  note?: string;
  /** A kit face frame graded like a pack face (face source "auto"). */
  quality?: { grade: "4k" | "hd" | "soft"; faceHeightPx: number; sharpness: number | null };
  width: number;
  height: number;
  from: string | null;
  /** Stock images, and cut-outs of them, carry who to credit. */
  credit?: string;
  license?: string;
  licenseUrl?: string;
  source?: string;
}
export type TurnMode = "standard" | "further";
export type FurtherModel = "opus" | "fable";
export interface Credit {
  name: string;
  credit: string;
  license: string;
  licenseUrl: string;
  source: string;
}
export interface Message {
  role: "user" | "assistant";
  text: string;
  at: string;
  version: number | null;
  /** Which kind of turn made this message, and the model id that ran it. */
  mode?: TurnMode;
  model?: string;
}
/** One measured judgement of a render; never blocks. Ids and meaning: docs/redesign-contract.md. */
export interface Check {
  id: string;
  level: "ok" | "warn" | "info";
  value: number | boolean | null;
  message: string;
}
export interface ProjectVersion {
  n: number;
  at: string;
  warnings: string[];
  /** Thumbnails only. */
  checks?: Check[];
}
export interface Project {
  schemaVersion: number;
  id: string;
  title: string;
  preset: PresetId;
  size: Size;
  createdAt: string;
  updatedAt: string;
  sessionId: string | null;
  brief: Record<string, string>;
  assets: AssetInfo[];
  messages: Message[];
  versions: ProjectVersion[];
  current: number | null;
  running: boolean;
  /** Library fields; absent on projects made before the library existed. */
  series?: string | null;
  starred?: boolean;
  /** Set when this project is one concept of a set (archetype and label are null until the plan is made). */
  conceptSet?: ConceptTag | null;
  /** The brand snapshotted into the project (its colours and fonts are in reference/brand.json). */
  brand?: { id: string; name: string };
  /** Set when the project was started from a Fabula kit. */
  kit?: { id: string; title: string; project: string; createdAt: string; contactSheet: boolean };
}
export interface ConceptTag {
  id: string;
  index: number;
  archetype: string | null;
  label: string | null;
}
/** The compact card the list endpoint returns (no conversation, no brief). */
export interface ProjectSummary {
  id: string;
  title: string;
  preset: PresetId;
  size: Size;
  series: string | null;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  current: number;
  thumbnail: string | null;
  conceptSet?: ConceptTag | null;
}
export type LibrarySort = "edited" | "newest" | "oldest" | "title";
export interface ListQuery {
  query?: string;
  preset?: PresetId;
  /** A series id, or "none" for projects outside any series. */
  series?: string;
  starred?: boolean;
  sort?: LibrarySort;
  offset?: number;
  limit?: number;
}
export interface ProjectList {
  items: ProjectSummary[];
  total: number;
}
export interface Series {
  id: string;
  name: string;
  createdAt: string;
  styleProjectId?: string;
  /** How many projects are in it (list only). */
  count?: number;
}
export type BulkAction = "delete" | "restore" | "star" | "unstar" | "series";
export interface BulkResult {
  ok: true;
  changed: string[];
  missing: string[];
}
export interface ReadyState {
  state: "ready" | "missing" | "signed-out";
  reason: string;
  fix: string;
}
export interface Capabilities {
  claude: ReadyState;
  renderer: { state: "ready" | "missing"; reason: string; fix: string };
  model: string;
  effort: string;
}
export interface PresetSize {
  id: string;
  label: string;
  /** Heading the size is listed under (platform, print, thumbnail format...). */
  group?: string;
  /** null for the server's "custom" entry (and photo aspects, which have no fixed pixels). */
  width?: number | null;
  height?: number | null;
}
export interface BriefField {
  id: string;
  label: string;
  required: boolean;
  multiline: boolean;
}
export interface PresetInfo {
  id: PresetId;
  label: string;
  description: string;
  /** null for photos: the first upload sets the canvas. */
  defaultSize: Size | null;
  /** Graphic and thumbnail sizes; for photos these are aspect ids ("original", "1:1", ...). */
  sizes: PresetSize[];
  briefFields: BriefField[];
  chips: string[];
}
export type ExportFormat = "png" | "jpg" | "webp";
export interface ExportResult {
  name: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  /** Stock images the exported design uses. */
  credits?: Credit[];
}

export type KitFormat = "landscape" | "vertical" | "square";
/** A Fabula thumbnail kit as the list endpoint describes it. */
export interface KitSummary {
  id: string;
  title: string;
  project: string;
  format: KitFormat;
  thumbnailFormat: "video" | "shorts" | "podcast";
  createdAt: string;
  durationSeconds: number;
  logline: string;
  counts: { face: number; screen: number; pictures: number; hooks: number; chapters: number };
  poster: string | null;
  /** What the form starts with; the owner edits it. */
  suggested: { title: string; channelColours: string; notes: string; format: string };
}
export interface KitList {
  items: KitSummary[];
  rejected: { name: string; reason: string }[];
}

export type ConceptState = "planning" | "waiting" | "designing" | "done" | "failed" | "cancelled" | "removed";
export type SetState = "draft" | "planning" | "designing" | "done" | "failed" | "cancelled";
export interface ConceptView {
  index: number;
  projectId: string;
  removed: boolean;
  state: ConceptState;
  error: string | null;
  archetype: string | null;
  label: string | null;
  idea: string | null;
  text: string | null;
  why: string | null;
  frame: string | null;
  title: string | null;
  current: number;
  versionCount: number;
  running: boolean;
  renderUrl: string | null;
  checks: { ok: number; warn: number; info: number; warnings: { id: string; message: string }[] };
  progress: string | null;
}
export interface ConceptSetView {
  id: string;
  title: string;
  format: "video" | "shorts" | "podcast";
  state: SetState;
  createdAt: string;
  updatedAt: string;
  count: number;
  kit: { id: string; title: string } | null;
  brand?: { id: string; name: string } | null;
  plan: { source: "planner" | "fallback" | null; note: string };
  costUsd: number;
  /** Only 16:9 sets can go to YouTube's Test & Compare. */
  testCompare: boolean;
  concepts: ConceptView[];
}
export interface ExportedFile {
  name: string;
  width: number;
  height: number;
  bytes: number;
  quality: number;
  overBudget: boolean;
  platform?: string;
  project?: string;
}
export interface ZipExport {
  name: string;
  url: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  files: ExportedFile[];
}
export type PlatformId = "youtube-shorts" | "instagram-reels" | "tiktok";
export const PLATFORM_LABELS: Record<PlatformId, string> = { "youtube-shorts": "YouTube Shorts", "instagram-reels": "Instagram Reels", tiktok: "TikTok" };
export type SetEvent =
  | { type: "snapshot"; set: ConceptSetView }
  | { type: "set"; set: ConceptSetView }
  | { type: "concept.progress"; index: number; text: string }
  | { type: "set.progress"; text: string };
export const SET_EVENT_NAMES: SetEvent["type"][] = ["snapshot", "set", "concept.progress", "set.progress"];

export type ServerEvent =
  | { type: "snapshot"; project: Project }
  | { type: "project"; project: Project }
  | { type: "run.started"; at: string; mode?: TurnMode; model?: string }
  | { type: "assistant.text"; text: string }
  | { type: "tool.use"; name: string; summary: string }
  | { type: "tool.done"; name: string; ok: boolean }
  | { type: "render.done"; version: number; url: string; warnings: string[]; checks?: Check[]; feedUrl?: string | null }
  | { type: "run.finished"; ok: boolean; costUsd: number; durationMs: number }
  | { type: "run.error"; code: string; message: string };

export const EVENT_NAMES: ServerEvent["type"][] = [
  "snapshot",
  "project",
  "run.started",
  "assistant.text",
  "tool.use",
  "tool.done",
  "render.done",
  "run.finished",
  "run.error",
];

export interface CreateBody {
  preset: PresetId;
  title?: string;
  /** Omit for photos: the server sizes the canvas from the first upload and brief.aspect. */
  size?: Size;
  brief: Record<string, string | string[]>;
  /** An existing series id. */
  series?: string;
  /** A Fabula kit id from `listKits`: its frames and pictures are imported and the brief is prefilled. */
  kit?: string;
  /** A brand id from `listBrands`; null or omitted means no brand. */
  brand?: string | null;
}
export interface CreateSetBody {
  title?: string;
  brief: Record<string, string | string[]>;
  kit?: string;
  brand?: string | null;
  /** 2 to 4. */
  count: number;
}

// ---- brands ----
export const BRAND_ROLES = ["primary", "accent", "ink", "light", "extra"] as const;
export type BrandRole = (typeof BRAND_ROLES)[number];
export const BRAND_ASSET_KINDS = ["logo", "mascot", "other"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];
export interface BrandColour {
  name: string;
  hex: string;
  role: BrandRole;
}
export interface BrandFont {
  family: string;
  weight?: number;
  /** font-variation-settings, e.g. `"SOFT" 100, "WONK" 1`. */
  settings?: string;
}
export interface BrandAsset {
  name: string;
  kind: BrandAssetKind;
  note: string;
  width: number;
  height: number;
  url: string;
}
export interface Brand {
  id: string;
  name: string;
  description: string;
  colours: BrandColour[];
  fonts: { display: BrandFont; support: BrandFont; mono?: BrandFont };
  devices: string[];
  guidance: string;
  assets: BrandAsset[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
/** What a create or update sends; assets and the default flag have their own calls or fields. */
export type BrandInput = Partial<Pick<Brand, "name" | "description" | "colours" | "fonts" | "devices" | "guidance" | "isDefault">>;
export interface BrandList {
  items: Brand[];
  defaultId: string | null;
}
export interface FontFamily {
  family: string;
  file: string;
  weights: number[];
  variable: boolean;
  role: string;
  category: string;
  note: string;
  stretch?: number[];
  axes?: Record<string, [number, number]>;
}
export interface FontCatalog {
  families: FontFamily[];
}

/** Everything the screens need from a server; the real client and the mock both implement it. */
// ---- the face pack ----
export const EXPRESSIONS = ["smile", "laugh", "surprise", "shock", "excited", "thinking", "sceptical", "confused", "intense", "angry", "sad", "neutral"] as const;
export const GESTURES = ["none", "point-left", "point-right", "point-camera", "point-up", "hands-up", "facepalm", "thumbs-up", "thumbs-down", "arms-crossed", "hand-on-chin", "holding-object", "other"] as const;
export const GAZES = ["camera", "left", "right", "up", "down"] as const;
export const HEAD_TURNS = ["frontal", "three-quarter", "profile"] as const;
export type FaceStage = "queued" | "cutting" | "classifying" | "ready" | "unclassified" | "failed";
export interface FaceLabels {
  expression: (typeof EXPRESSIONS)[number];
  intensity: 1 | 2 | 3;
  gesture: (typeof GESTURES)[number];
  gaze: (typeof GAZES)[number];
  headTurn: (typeof HEAD_TURNS)[number];
  eyesOpen: boolean;
  textOrLogoInShot: boolean;
  description: string;
  faceBox?: { x: number; y: number; w: number; h: number };
}
export interface FaceView {
  id: string;
  addedAt: string;
  filename: string;
  stage: FaceStage;
  /** Why it failed or is unclassified; empty otherwise. */
  error: string;
  original: { width: number; height: number; url: string };
  cutout: { state: string; width: number | null; height: number | null; url: string | null; thumbUrl: string | null };
  labels: FaceLabels | null;
  labelsEditedByOwner: boolean;
  /** null follows the pack setting and the label; true or false is the owner's choice. */
  mirrorAllowed: boolean | null;
  quality: { grade: "4k" | "hd" | "soft"; faceHeightPx: number; sharpness: number | null } | null;
  starred: boolean;
  hidden: boolean;
  retouch: FaceRetouch;
}
/** Local photo retouching of the cut-out (tone and texture only). `url` and `thumbUrl` exist once it is done. */
export interface FaceRetouch {
  /** What designs get: the retouched image (true) or the plain cut-out. */
  enabled: boolean;
  /** The owner's choice for this face; null follows the pack setting. */
  override: boolean | null;
  /** The strength in force (this face's own, else the pack's), 0 to 1. */
  strength: number;
  ownStrength: number | null;
  state: "none" | "queued" | "running" | "done" | "failed";
  /** The strength the file on disk was made at; differs from `strength` until it is redone. */
  appliedStrength: number | null;
  error: string;
  url: string | null;
  thumbUrl: string | null;
}
export interface FaceSettings {
  mirrorAll: boolean;
  retouchAll: boolean;
  retouchStrength: number;
}
export interface FaceList {
  items: FaceView[];
  counts: { total: number; ready: number; hidden: number; working: number; retouching: number; unclassified: number };
  model: string;
  settings: FaceSettings;
}
export interface FacePatch {
  starred?: boolean;
  hidden?: boolean;
  mirrorAllowed?: boolean | null;
  /** true or false is the owner's choice for this face; null follows the pack. */
  retouch?: boolean | null;
  /** 0 to 1; null follows the pack's strength. */
  retouchStrength?: number | null;
  labels?: Partial<Omit<FaceLabels, "faceBox">>;
}

export interface Api {
  capabilities(): Promise<Capabilities>;
  listFonts(): Promise<FontCatalog>;
  listBrands(): Promise<BrandList>;
  createBrand(body: BrandInput): Promise<Brand>;
  updateBrand(id: string, patch: BrandInput): Promise<Brand>;
  deleteBrand(id: string): Promise<void>;
  uploadBrandAsset(id: string, file: File, meta: { kind: BrandAssetKind; note: string }): Promise<BrandAsset>;
  updateBrandAsset(id: string, name: string, patch: { kind?: BrandAssetKind; note?: string }): Promise<BrandAsset>;
  deleteBrandAsset(id: string, name: string): Promise<void>;
  presets(): Promise<PresetInfo[]>;
  listProjects(query?: ListQuery): Promise<ProjectList>;
  patchProject(id: string, patch: { title?: string; starred?: boolean; series?: string | null }): Promise<Project>;
  duplicateProject(id: string): Promise<Project>;
  /** A new project in the source's series and style; `title` and `brief` carry the new content. */
  newInStyle(id: string, body: { title?: string; brief?: Record<string, string> }): Promise<Project>;
  bulk(action: BulkAction, ids: string[], series?: string | null): Promise<BulkResult>;
  /** URL that downloads the current render of each project as one zip. */
  exportZipUrl(ids: string[]): string;
  listSeries(): Promise<Series[]>;
  createSeries(name: string): Promise<Series>;
  updateSeries(id: string, patch: { name?: string }): Promise<Series>;
  deleteSeries(id: string): Promise<void>;
  createProject(body: CreateBody): Promise<Project>;
  getProject(id: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  uploadAsset(id: string, file: File): Promise<{ name: string; width: number; height: number }>;
  cutout(id: string, name: string): Promise<{ name: string; width: number; height: number }>;
  sendMessage(id: string, text: string, opts?: { mode?: TurnMode; model?: FurtherModel }): Promise<void>;
  cancel(id: string): Promise<void>;
  restore(id: string, version: number): Promise<Project>;
  exportProject(id: string, body: { format: ExportFormat; scale: number }): Promise<ExportResult>;
  subscribe(id: string, onEvent: (e: ServerEvent) => void): () => void;
  /** URL of the PNG render of a version. */
  renderUrl(id: string, version: number): string;
  /** URL of the feed mock-up PNG of a version (thumbnails only; 404 when there is none). */
  feedUrl(id: string, version: number): string;
  /** URL of the live design.html, for the sandboxed preview. `nonce` busts the cache. */
  designUrl(id: string, nonce: number): string;
  /** URL of an uploaded asset, for thumbnails. */
  assetUrl(id: string, name: string): string;
  listKits(): Promise<KitList>;
  createConceptSet(body: CreateSetBody): Promise<ConceptSetView>;
  uploadSetAsset(id: string, file: File): Promise<{ name: string; width: number; height: number }>;
  startConceptSet(id: string): Promise<ConceptSetView>;
  getConceptSet(id: string): Promise<ConceptSetView>;
  cancelConceptSet(id: string): Promise<ConceptSetView>;
  anotherConcept(id: string): Promise<ConceptSetView>;
  subscribeSet(id: string, onEvent: (e: SetEvent) => void): () => void;
  /** Test & Compare zip of the chosen concepts (at most three). */
  testCompare(id: string, projects?: string[]): Promise<ZipExport>;
  /** Vertical covers per platform; one platform is a JPG, several a zip. */
  platformExport(id: string, platforms?: PlatformId[]): Promise<ZipExport>;
  listFaces(): Promise<FaceList>;
  uploadFace(file: File): Promise<FaceView>;
  patchFace(id: string, patch: FacePatch): Promise<FaceView>;
  deleteFace(id: string): Promise<void>;
  restoreFace(id: string): Promise<FaceView>;
  /** Asks Claude again for these faces (all by default); faces with the owner's labels come back as skipped. */
  reclassifyFaces(ids?: string[]): Promise<{ changed: string[]; skipped: string[] }>;
  recutFace(id: string): Promise<FaceView>;
  /** Any of the pack settings; what is left out keeps its value. */
  setFaceSettings(settings: Partial<FaceSettings>): Promise<FaceSettings>;
  /** Retouches these faces again (all by default); a face switched off comes back as skipped. Runs in the background. */
  retouchFaces(ids?: string[]): Promise<{ changed: string[]; skipped: string[] }>;
}
