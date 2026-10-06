export type PresetId = "thumbnail" | "photo" | "graphic";

export interface Size {
  width: number;
  height: number;
}
export interface AssetInfo {
  name: string;
  kind: "upload" | "cutout" | "stock";
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
  versions: { n: number; at: string; warnings: string[] }[];
  current: number | null;
  running: boolean;
}
export interface ProjectSummary {
  id: string;
  title: string;
  preset: PresetId;
  updatedAt: string;
  thumbnail: string | null;
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

export type ServerEvent =
  | { type: "snapshot"; project: Project }
  | { type: "project"; project: Project }
  | { type: "run.started"; at: string; mode?: TurnMode; model?: string }
  | { type: "assistant.text"; text: string }
  | { type: "tool.use"; name: string; summary: string }
  | { type: "tool.done"; name: string; ok: boolean }
  | { type: "render.done"; version: number; url: string; warnings: string[] }
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
  brief: Record<string, string>;
}

/** Everything the screens need from a server; the real client and the mock both implement it. */
export interface Api {
  capabilities(): Promise<Capabilities>;
  presets(): Promise<PresetInfo[]>;
  listProjects(): Promise<ProjectSummary[]>;
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
  /** URL of the live design.html, for the sandboxed preview. `nonce` busts the cache. */
  designUrl(id: string, nonce: number): string;
  /** URL of an uploaded asset, for thumbnails. */
  assetUrl(id: string, name: string): string;
}
