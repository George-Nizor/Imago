// A stand-in server for building and screenshotting the UI without the real one. It is used only
// when the page is opened with `?mock=1` (or `?mock=signedout` for the unready panel), or in dev
// with VITE_IMAGO_MOCK=1. It simulates a turn with the same events the server sends and renders
// placeholder images, so nothing here spends a subscription.
import type {
  Api,
  AssetInfo,
  Brand,
  BrandAsset,
  BrandInput,
  FontCatalog,
  Capabilities,
  Check,
  ConceptSetView,
  ConceptView,
  ExportFile,
  FaceStatus,
  FaceUsage,
  QuickExport,
  RefreshResult,
  CreateBody,
  CreateSetBody,
  FaceLabels,
  FaceList,
  FacePatch,
  FaceSettings,
  FaceView,
  KitSummary,
  PlatformId,
  SetEvent,
  ZipExport,
  PresetInfo,
  Project,
  ProjectSummary,
  Series,
  ServerEvent,
  Size,
  TurnMode,
} from "./types.js";
import { ApiError } from "./client.js";
import { EXPRESSIONS, GAZES, GESTURES } from "./types.js";
import { ASPECTS, ASPECT_LABELS, GRAPHIC_SIZES, THUMBNAIL_FORMATS } from "../presets.js";

const SIZES: Record<string, Size> = { thumbnail: { width: 1280, height: 720 }, photo: { width: 1620, height: 1080 }, graphic: { width: 1080, height: 1080 } };

// Mirrors server/presets/index.mjs (ids, sizes, brief fields, chips).
const PRESETS: PresetInfo[] = [
  {
    id: "thumbnail",
    label: "YouTube thumbnail",
    description: "A 1280×720 thumbnail built to be read at a glance.",
    defaultSize: SIZES.thumbnail!,
    sizes: [
      { id: "video", label: "Video 16:9", group: "YouTube", width: 1280, height: 720 },
      { id: "shorts", label: "Shorts 9:16", group: "YouTube", width: 720, height: 1280 },
      { id: "podcast", label: "Podcast 1:1", group: "YouTube", width: 1280, height: 1280 },
    ],
    briefFields: [
      { id: "title", label: "Video title or topic", required: true, multiline: false },
      { id: "channelColours", label: "Channel colours", required: false, multiline: false },
      { id: "notes", label: "Notes", required: false, multiline: true },
      { id: "format", label: "Format", required: false, multiline: false },
    ],
    chips: ["Bigger text", "More contrast", "Swap sides", "Another direction"],
  },
  {
    id: "photo",
    label: "Edit a photo",
    description: "Upload a photo and say what to change: grade, crop, background, text.",
    defaultSize: null,
    sizes: ASPECTS.map((id) => ({ id, label: ASPECT_LABELS[id] ?? id })),
    briefFields: [{ id: "instruction", label: "What should change?", required: true, multiline: true }],
    chips: ["Warmer", "Cooler", "Tighter crop", "Remove background"],
  },
  {
    id: "graphic",
    label: "Custom graphic",
    description: "A poster, post, banner or cover from a description.",
    defaultSize: SIZES.graphic!,
    sizes: [
      ...GRAPHIC_SIZES.map((g) => ({ id: g.id, label: g.label, group: g.group, width: g.size.width, height: g.size.height })),
      { id: "custom", label: "Custom (64–4096 px)", group: "Custom", width: null, height: null },
    ],
    briefFields: [{ id: "description", label: "What should it show?", required: true, multiline: true }],
    chips: ["Simplify", "Bolder", "Different palette"],
  },
];

const HUES = [172, 215, 20, 285, 95];
function placeholder(size: Size, title: string, n: number, hue: number): string {
  const { width: w, height: h } = size;
  const fs = Math.round(Math.min(w, h) / 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 22%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 75% 48%)"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${w * 0.78}" cy="${h * 0.42}" r="${h * 0.3}" fill="hsl(${hue} 80% 70% / .35)"/>
<rect x="${w * 0.07}" y="${h * 0.62}" width="${w * 0.5}" height="${fs * 0.22}" rx="${fs * 0.11}" fill="#fff" opacity=".85"/>
<text x="${w * 0.07}" y="${h * 0.45}" font-family="sans-serif" font-weight="800" font-size="${fs * 1.5}" fill="#fff">${esc(title.slice(0, 18).toUpperCase())}</text>
<text x="${w * 0.07}" y="${h * 0.9}" font-family="monospace" font-size="${fs * 0.5}" fill="#fff" opacity=".7">placeholder v${n}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface MockProject extends Project {
  sizeAuto?: boolean;
  renders: Record<number, string>;
}
const projects = new Map<string, MockProject>();
const trash = new Map<string, MockProject>();
const listeners = new Map<string, Set<(e: ServerEvent) => void>>();
const cancelled = new Set<string>();
let counter = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const speed = Number(new URLSearchParams(location.search).get("speed")) || 1;
const wait = (ms: number) => sleep(ms / speed);
const strip = ({ renders: _r, sizeAuto: _a, ...p }: MockProject): Project => structuredClone(p);

function emit(id: string, e: ServerEvent) {
  for (const fn of listeners.get(id) ?? []) fn(e);
}
function touch(p: MockProject) {
  p.updatedAt = new Date().toISOString();
  emit(p.id, { type: "project", project: strip(p) });
}
const MOCK_CHECKS: Check[] = [
  { id: "text.words", level: "ok", value: 3, message: "3 words." },
  { id: "text.repeatsTitle", level: "warn", value: 0.67, message: "67% of the text repeats the video title. Add something the title does not say, or drop it." },
  { id: "text.smallest", level: "warn", value: 5.4, message: "\"watch live\" is 5.4 px tall at 168 px wide (floor 7). Make it at least 54px, or cut it." },
  { id: "text.contrast", level: "ok", value: 7.9, message: "Weakest text contrast is 7.9:1." },
  { id: "layout.badge", level: "ok", value: true, message: "Duration badge zone is clear." },
  { id: "subject.size", level: "info", value: null, message: "No cut-out subject." },
  { id: "image.contrast", level: "info", value: 0.71, message: "Luminance spread 0.71. Within 0.55 to 0.95." },
  { id: "image.colourfulness", level: "info", value: 41.2, message: "Colourfulness 41.2. Vivid." },
  { id: "feed.distinct", level: "info", value: 31.5, message: "Stands out: average colour difference 31.5 from stand-in thumbnails (closest 22.4)." },
];
function addVersion(p: MockProject): number {
  const n = (p.versions.at(-1)?.n ?? 0) + 1;
  p.versions.push({ n, at: new Date().toISOString(), warnings: [], ...(p.preset === "thumbnail" ? { checks: MOCK_CHECKS } : {}) });
  p.renders[n] = placeholder(p.size, p.title, n, HUES[(n + p.id.length) % HUES.length]!);
  p.current = n;
  return n;
}
function seed(title: string, preset: Project["preset"], versions: number, ageMin: number) {
  const id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(++counter).toString(36)}x`;
  const at = new Date(Date.now() - ageMin * 60_000).toISOString();
  const p: MockProject = {
    schemaVersion: 1, id, title, preset, size: SIZES[preset]!, createdAt: at, updatedAt: at, sessionId: null,
    brief: {}, assets: [], messages: [], versions: [], current: null, running: false, renders: {},
  };
  for (let i = 0; i < versions; i++) addVersion(p);
  projects.set(id, p);
}
seed("Rocket launch thumbnail", "thumbnail", 3, 25);
// A pack face in the first design, so Refresh faces and Try other faces can be tried.
projects.values().next().value!.assets.push({ name: "face-00000001-sticker.png", kind: "face", faceId: "00000001", mirrored: false, sticker: true, width: 2393, height: 1814, from: null });
seed("Why I quit my job", "thumbnail", 2, 60 * 3);
seed("Budget gaming PC build", "thumbnail", 1, 60 * 8);
seed("Beach sunset retouch", "photo", 2, 60 * 5);
seed("Spring sale poster", "graphic", 4, 60 * 30);
seed("Channel banner", "graphic", 1, 60 * 70);

const series = new Map<string, Series>();
// `?mock=library` fills the library with sixty projects in three series, to try search, paging and bulk actions.
if (new URLSearchParams(location.search).get("mock") === "library") {
  for (const [id, name] of [["rocket-channel", "Rocket Channel"], ["garden-diaries", "Garden Diaries"], ["chess-minutes", "Chess in Minutes"]] as const) series.set(id, { id, name, createdAt: new Date().toISOString() });
  const topics = ["Rocket", "Garden", "Chess", "Pasta", "Budget", "Moon", "Robot", "Bike"];
  for (let i = 0; i < 60; i++) {
    seed(`${topics[i % topics.length]} episode ${i + 1}`, i % 7 === 3 ? "graphic" : i % 11 === 5 ? "photo" : "thumbnail", 1 + (i % 4), 90 + i * 37);
    const p = [...projects.values()].at(-1)!;
    if (i % 4 !== 3) p.series = [...series.keys()][i % 3]!;
    p.starred = i % 9 === 0;
  }
}

const mode = new URLSearchParams(location.search).get("mock");
const caps: Capabilities =
  mode === "signedout"
    ? {
        claude: { state: "signed-out", reason: "Claude Code is installed but isn't signed in to a subscription.", fix: "claude auth login" },
        renderer: { state: "ready", reason: "", fix: "" },
        model: "claude-sonnet-5-5",
        effort: "medium",
      }
    : {
        claude: { state: "ready", reason: "", fix: "" },
        renderer: { state: "ready", reason: "", fix: "" },
        model: "claude-sonnet-5-5",
        effort: "medium",
      };

const MODEL_IDS = { standard: "claude-sonnet-5-5", opus: "claude-opus-5-5", fable: "claude-fable-5-1" };
const FURTHER_DIRECTION = "Take this design further: rethink it with full creative freedom and make it exceptional, keeping the brief's content and intent.";

async function runTurn(p: MockProject, text: string, mode: TurnMode = "standard", model = MODEL_IDS.standard) {
  const id = p.id;
  p.running = true;
  cancelled.delete(id);
  emit(id, { type: "run.started", at: new Date().toISOString(), mode, model });
  const further = mode === "further";
  const steps: ServerEvent[] = further ? [
    { type: "tool.use", name: "Read", summary: "Reading the last version" },
    { type: "assistant.text", text: "The layout is safe but flat. I'm rebuilding it around one big photo with the title cut into it." },
    { type: "tool.use", name: "mcp__imago__search_images", summary: 'Searching stock images for "rocket launch night"' },
    { type: "tool.use", name: "mcp__imago__fetch_image", summary: "Fetching an image" },
    { type: "tool.use", name: "Write", summary: "Writing design.html" },
    { type: "tool.use", name: "mcp__imago__render", summary: "Rendering" },
  ] : [
    { type: "tool.use", name: "Read", summary: "Reading your brief and assets" },
    { type: "assistant.text", text: "Got it. I'm going for a high-contrast layout: big type on the left, the subject on the right." },
    { type: "tool.use", name: "Write", summary: "Writing design.html" },
    { type: "tool.use", name: "mcp__imago__render", summary: "Rendering" },
  ];
  const t0 = Date.now();
  for (const s of steps) {
    await wait(1400);
    if (cancelled.has(id)) return stopped(p);
    emit(id, s);
    if (s.type === "tool.use" && s.name === "Write") {
      await wait(500);
      emit(id, { type: "tool.done", name: "Write", ok: true });
    }
  }
  await wait(1500);
  if (cancelled.has(id)) return stopped(p);
  const n = addVersion(p);
  emit(id, { type: "render.done", version: n, url: `/projects/${id}/renders/v${n}.png`, warnings: [], ...(p.preset === "thumbnail" ? { checks: MOCK_CHECKS, feedUrl: `/projects/${id}/renders/v${n}-feed.png` } : {}) });
  await wait(700);
  if (further && !p.assets.some((a) => a.kind === "stock")) {
    p.assets.push({ name: "stock-rocket-night.jpg", kind: "stock", width: 4000, height: 2667, from: null, credit: "Joel Kowsky / NASA", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/", source: "flickr" });
  }
  const reply = further
    ? `Here's version ${n}. I rebuilt it around a night launch photo, pushed the title huge and warm against the cold sky, and checked it at 320 px wide.`
    : `Here's version ${n}. I kept the headline short so it reads at small sizes. Want it warmer, bigger, or a different layout?`;
  emit(id, { type: "assistant.text", text: reply });
  p.messages.push({ role: "assistant", text: reply, at: new Date().toISOString(), version: n, mode, model });
  p.running = false;
  touch(p);
  emit(id, { type: "run.finished", ok: true, costUsd: 0.0837 + (text.length % 7) / 100, durationMs: Date.now() - t0 });
}
function stopped(p: MockProject) {
  p.running = false;
  touch(p);
  emit(p.id, { type: "run.error", code: "CANCELLED", message: "Cancelled" });
}

const need = (id: string) => {
  const p = projects.get(id);
  if (!p) throw new ApiError("NOT_FOUND", "No such project", 404);
  return p;
};

// ---- Fabula kits and concept sets ----
const kitPoster = (title: string, hue: number) => placeholder({ width: 1280, height: 720 }, title, 1, hue);
const KITS: KitSummary[] = [
  {
    id: "mockkit00000001", title: "We released the game", project: "early-access", format: "landscape", thumbnailFormat: "video",
    createdAt: "2026-10-13T12:00:00.000Z", durationSeconds: 611, logline: "A studio ships its first game and shows the launch week.",
    counts: { face: 8, screen: 3, pictures: 4, hooks: 5, chapters: 6 }, poster: kitPoster("We released the game", 5),
    suggested: { title: "We released the game", channelColours: "accent #E8413C, accent2 #43D35B, text #F4F0E6", notes: "A studio ships its first game and shows the launch week.", format: "video" },
  },
  {
    id: "mockkit00000002", title: "Three tips for sleep", project: "sleep-short", format: "vertical", thumbnailFormat: "shorts",
    createdAt: "2026-09-20T09:00:00.000Z", durationSeconds: 48, logline: "Three small habits that fix a broken sleep schedule.",
    counts: { face: 5, screen: 0, pictures: 1, hooks: 3, chapters: 0 }, poster: kitPoster("Three tips for sleep", 215),
    suggested: { title: "Three tips for sleep", channelColours: "accent #5E9EFD", notes: "Three small habits that fix a broken sleep schedule.", format: "shorts" },
  },
];
const ARCHETYPES: [string, string, string, string][] = [
  ["reaction", "Shocked first look", "The strongest expression, big, with a word that teases the cause.", "People click to find out what caused the face, and the video answers it."],
  ["result-reveal", "The number on screen", "The result the video shows, large, with the subject beside it.", "It promises the payoff the video delivers in its second minute."],
  ["curiosity-gap", "Pointing at the gap", "The subject points at something the picture withholds.", "A question the viewer wants closed, kept honest by the video."],
  ["object-hero", "The one object", "The object the video is about, large and clean.", "Clear at 168 px and true to what the video shows."],
];
interface MockSet { view: ConceptSetView; draftFiles: number }
const sets = new Map<string, MockSet>();
const setListeners = new Map<string, Set<(e: SetEvent) => void>>();
const pushSet = (id: string) => {
  const m = sets.get(id);
  if (!m) return;
  const v = m.view;
  for (const c of v.concepts) {
    const p = projects.get(c.projectId);
    if (!p) continue;
    c.current = p.current ?? 0;
    c.versionCount = p.versions.length;
    c.renderUrl = p.current ? p.renders[p.current]! : null;
    c.running = p.running;
    const checks = p.versions.find((x) => x.n === p.current)?.checks ?? [];
    c.checks = { ok: checks.filter((k) => k.level === "ok").length, warn: checks.filter((k) => k.level === "warn").length, info: checks.filter((k) => k.level === "info").length, warnings: checks.filter((k) => k.level === "warn").map((k) => ({ id: k.id, message: k.message })) };
  }
  const states = v.concepts.map((c) => c.state);
  if (v.state !== "draft") v.state = states.includes("planning") ? "planning" : states.some((s) => s === "waiting" || s === "designing") ? "designing" : states.includes("done") ? "done" : states.every((s) => s === "cancelled") ? "cancelled" : "failed";
  v.updatedAt = new Date().toISOString();
  for (const fn of setListeners.get(id) ?? []) fn({ type: "set", set: structuredClone(v) });
};
const setCancelled = new Set<string>();
const exportsOf = new Map<string, ExportFile[]>();
const refreshedFaces = new Set<string>();
async function designConcept(setId: string, c: ConceptView, delay: number) {
  const m = sets.get(setId)!;
  await wait(delay);
  if (setCancelled.has(setId)) {
    c.state = "cancelled";
    return pushSet(setId);
  }
  c.state = "designing";
  pushSet(setId);
  const p = projects.get(c.projectId)!;
  const text = m.view.kind === "faces" ? `Change only the face. Replace assets/face-00000001-sticker.png with assets/face-${c.face}-sticker.png in design.html.` : `Make concept ${c.index + 1}`;
  p.messages.push({ role: "user", text, at: new Date().toISOString(), version: null });
  if (!m.view.titles && m.view.kind !== "faces") p.title = `${m.view.title} · ${c.label}`;
  p.running = true;
  await runTurn(p, text);
  c.state = setCancelled.has(setId) ? "cancelled" : "done";
  pushSet(setId);
}
async function driveSet(id: string) {
  const m = sets.get(id)!;
  m.view.state = "planning";
  for (const c of m.view.concepts) c.state = "planning";
  pushSet(id);
  await wait(2200);
  if (setCancelled.has(id)) {
    for (const c of m.view.concepts) c.state = "cancelled";
    return pushSet(id);
  }
  m.view.plan = { source: "planner", note: "" };
  m.view.concepts.forEach((c, i) => {
    const [archetype, label, idea, why] = ARCHETYPES[i % ARCHETYPES.length]!;
    Object.assign(c, { archetype, label, idea, why, text: ["WE DID IT", "SEE WHY", "10,000"][i % 3], state: "waiting" as const });
  });
  pushSet(id);
  await Promise.all(m.view.concepts.map((c, i) => designConcept(id, c, i * 500)));
}
const kitOf = (id: string | undefined) => KITS.find((k) => k.id === id);

// ---- brands (stand-in) ----
const fam = (family: string, weights: number[], role: string, category: string, axes?: Record<string, [number, number]>) => ({ family, file: `${family.replace(/ /g, "")}.ttf`, weights, variable: weights.length > 1, role, category, note: "", ...(axes && { axes }) });
const FONTS: FontCatalog = {
  families: [
    fam("Anton", [400], "display", "sans"),
    fam("Archivo", [100, 900], "display", "sans"),
    fam("Bebas Neue", [400], "display", "sans"),
    fam("Commissioner", [100, 900], "text", "sans", { FLAR: [0, 100], VOLM: [0, 100], slnt: [-12, 0] }),
    fam("Fraunces", [100, 900], "display", "serif", { opsz: [9, 144], SOFT: [0, 100], WONK: [0, 1] }),
    fam("Inter", [100, 900], "text", "sans"),
    fam("Montserrat", [100, 900], "display", "sans"),
    fam("Spline Sans Mono", [300, 700], "text", "mono"),
  ],
};
const stamp = new Date().toISOString();
const brands: Brand[] = [
  {
    id: "instrumenta-1a2b", name: "Instrumenta", description: "The suite's own look: warm brass, a teal pop and friendly, wonky serifs.",
    colours: [
      { name: "Brass", hex: "#D58E00", role: "primary" }, { name: "Imago teal", hex: "#00BCAB", role: "accent" },
      { name: "Ink", hex: "#1B1B1F", role: "ink" }, { name: "Paper", hex: "#FFF8EC", role: "light" }, { name: "Coral", hex: "#ED7088", role: "extra" },
    ],
    fonts: { display: { family: "Fraunces", weight: 850, settings: '"SOFT" 100, "WONK" 1, "opsz" 144' }, support: { family: "Commissioner", weight: 500, settings: '"FLAR" 40' }, mono: { family: "Spline Sans Mono", weight: 500 } },
    devices: ["A thick brass underline under the key word", "Soft rounded corners on every shape", "One small teal sparkle"],
    guidance: "Warm and a little playful. Never neon. Keep the type big and friendly.",
    assets: [], isDefault: true, createdAt: stamp, updatedAt: stamp,
  },
  {
    id: "night-shift-3c4d", name: "Night Shift", description: "A dark, punchy gaming channel.",
    colours: [{ name: "Void", hex: "#0B0D17", role: "ink" }, { name: "Volt", hex: "#C6FF3D", role: "primary" }, { name: "Hot pink", hex: "#FF3D8B", role: "accent" }, { name: "White", hex: "#FFFFFF", role: "light" }],
    fonts: { display: { family: "Anton" }, support: { family: "Inter", weight: 600 } },
    devices: ["A hard offset shadow"], guidance: "", assets: [], isDefault: false, createdAt: stamp, updatedAt: stamp,
  },
];
let brandCounter = 100;
const needBrand = (id: string) => {
  const b = brands.find((x) => x.id === id);
  if (!b) throw new ApiError("NOT_FOUND", "No such brand.", 404);
  return b;
};
function snapshotBrand(p: MockProject, brandId: string | null | undefined) {
  if (!brandId) return;
  const b = needBrand(brandId);
  p.brand = { id: b.id, name: b.name };
  p.assets.push(...b.assets.map((a): AssetInfo => ({ name: `brand-${a.name}`, kind: "brand", width: a.width, height: a.height, from: null, brandKind: a.kind, note: a.note })));
}

export const mockApi: Api = {
  async listFonts() {
    return structuredClone(FONTS);
  },
  async listBrands() {
    await wait(150);
    return { items: structuredClone(brands), defaultId: brands.find((b) => b.isDefault)?.id ?? null };
  },
  async createBrand(body: BrandInput) {
    if (!body.name?.trim()) throw new ApiError("BAD_NAME", "A brand needs a name.", 400);
    if (!body.colours?.length) throw new ApiError("BAD_COLOURS", "A brand needs at least one colour.", 400);
    if (brands.some((b) => b.name.toLowerCase() === body.name!.trim().toLowerCase())) throw new ApiError("EXISTS", `There is already a brand called "${body.name}".`, 409);
    const now = new Date().toISOString();
    const b: Brand = {
      id: `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}-${(++brandCounter).toString(16)}`, name: body.name.trim(), description: body.description ?? "", colours: body.colours,
      fonts: body.fonts ?? { display: { family: "Fraunces" }, support: { family: "Commissioner" } }, devices: body.devices ?? [], guidance: body.guidance ?? "", assets: [], isDefault: false, createdAt: now, updatedAt: now,
    };
    if (body.isDefault) for (const x of brands) x.isDefault = false;
    b.isDefault = body.isDefault === true;
    brands.push(b);
    await wait(200);
    return structuredClone(b);
  },
  async updateBrand(id, patch) {
    const b = needBrand(id);
    if (patch.name !== undefined && !patch.name.trim()) throw new ApiError("BAD_NAME", "A brand needs a name.", 400);
    if (patch.name && brands.some((x) => x.id !== id && x.name.toLowerCase() === patch.name!.trim().toLowerCase())) throw new ApiError("EXISTS", `There is already a brand called "${patch.name}".`, 409);
    const { isDefault, ...rest } = patch;
    Object.assign(b, rest);
    if (isDefault !== undefined) {
      if (isDefault) for (const x of brands) x.isDefault = false;
      b.isDefault = isDefault;
    }
    b.updatedAt = new Date().toISOString();
    await wait(150);
    return structuredClone(b);
  },
  async deleteBrand(id) {
    needBrand(id);
    brands.splice(brands.findIndex((b) => b.id === id), 1);
  },
  async uploadBrandAsset(id, file, meta) {
    const b = needBrand(id);
    await wait(300);
    const dims = await createImageBitmap(file).catch(() => null);
    let name = file.name.replace(/[^A-Za-z0-9._-]+/g, "-");
    while (b.assets.some((a) => a.name === name)) name = `2-${name}`;
    const a: BrandAsset = { name, kind: meta.kind, note: meta.note, width: dims?.width ?? 600, height: dims?.height ?? 200, url: URL.createObjectURL(file) };
    b.assets.push(a);
    return structuredClone(a);
  },
  async updateBrandAsset(id, name, patch) {
    const a = needBrand(id).assets.find((x) => x.name === name);
    if (!a) throw new ApiError("NOT_FOUND", "No such asset.", 404);
    Object.assign(a, patch);
    return structuredClone(a);
  },
  async deleteBrandAsset(id, name) {
    const b = needBrand(id);
    b.assets = b.assets.filter((a) => a.name !== name);
  },
  async listKits() {
    await wait(150);
    return { items: structuredClone(KITS), rejected: [] };
  },
  async createConceptSet(body: CreateSetBody) {
    const kit = kitOf(body.kit);
    const brief: Record<string, string | string[]> = { ...body.brief, ...(kit ? { title: String(body.brief.title || kit.suggested.title) } : {}) };
    const brand = body.brand ? needBrand(body.brand) : null;
    const title = body.title || String(brief.title || "Thumbnails");
    const id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${(++counter).toString(36)}s`;
    const format = (String(brief.format ?? kit?.suggested.format ?? "video")) as ConceptSetView["format"];
    const concepts: ConceptView[] = [];
    const count = body.titles ? body.titles.length : (body.count ?? 3);
    for (let i = 0; i < count; i++) {
      const own = body.titles?.[i];
      const made = await this.createProject({ preset: "thumbnail", title: own ?? `${title} · concept ${i + 1}`, brief: { ...brief, ...(own ? { title: own } : {}), format }, brand: brand?.id });
      const p = projects.get(made.id)!;
      p.conceptSet = { id, index: i, archetype: null, label: null };
      concepts.push({ index: i, forTitle: own ?? null, projectId: made.id, removed: false, state: "planning", error: null, archetype: null, label: null, idea: null, text: null, why: null, frame: null, title: p.title, current: 0, versionCount: 0, running: false, renderUrl: null, checks: { ok: 0, warn: 0, info: 0, warnings: [] }, progress: null });
    }
    const now = new Date().toISOString();
    const view: ConceptSetView = { id, title, format, titles: body.titles ?? null, state: "draft", createdAt: now, updatedAt: now, count, kit: kit ? { id: kit.id, title: kit.title } : null, brand: brand ? { id: brand.id, name: brand.name } : null, plan: { source: null, note: "" }, costUsd: 0, testCompare: format === "video", concepts };
    sets.set(id, { view, draftFiles: 0 });
    return structuredClone(view);
  },
  async uploadSetAsset(id, file) {
    sets.get(id)!.draftFiles += 1;
    await wait(300);
    return { name: file.name, width: 800, height: 800 };
  },
  async startConceptSet(id) {
    const m = sets.get(id);
    if (!m) throw new ApiError("NOT_FOUND", "No such concept set.", 404);
    setCancelled.delete(id);
    void driveSet(id);
    return structuredClone(m.view);
  },
  async getConceptSet(id) {
    const m = sets.get(id);
    if (!m) throw new ApiError("NOT_FOUND", "No such concept set.", 404);
    pushSet(id);
    return structuredClone(m.view);
  },
  async cancelConceptSet(id) {
    setCancelled.add(id);
    for (const c of sets.get(id)!.view.concepts) {
      cancelled.add(c.projectId);
      if (c.state === "waiting" || c.state === "planning") c.state = "cancelled";
    }
    pushSet(id);
    return structuredClone(sets.get(id)!.view);
  },
  async anotherConcept(id) {
    const m = sets.get(id)!;
    const used = m.view.concepts.map((c) => c.archetype);
    const [archetype, label, idea, why] = ARCHETYPES.find((a) => !used.includes(a[0])) ?? ARCHETYPES[3]!;
    const made = await this.createProject({ preset: "thumbnail", title: `${m.view.title} · ${label}`, brief: { title: m.view.title, format: m.view.format } });
    const p = projects.get(made.id)!;
    const index = m.view.concepts.length;
    p.conceptSet = { id, index, archetype, label };
    const c: ConceptView = { index, projectId: made.id, removed: false, state: "waiting", error: null, archetype, label, idea, text: null, why, frame: null, title: p.title, current: 0, versionCount: 0, running: false, renderUrl: null, checks: { ok: 0, warn: 0, info: 0, warnings: [] }, progress: null };
    m.view.concepts.push(c);
    m.view.count = m.view.concepts.length;
    setCancelled.delete(id);
    pushSet(id);
    void designConcept(id, c, 0);
    return structuredClone(m.view);
  },
  subscribeSet(id, onEvent) {
    let set = setListeners.get(id);
    if (!set) setListeners.set(id, (set = new Set()));
    set.add(onEvent);
    const t = setTimeout(() => {
      const m = sets.get(id);
      if (m) onEvent({ type: "snapshot", set: structuredClone(m.view) });
    }, 0);
    return () => {
      clearTimeout(t);
      set!.delete(onEvent);
    };
  },
  async quickExport(id) {
    const p = need(id);
    await wait(900);
    const name = `${p.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design"}-v${p.current ?? 1}.jpg`;
    const list = (exportsOf.get(id) ?? []).filter((f) => f.name !== name);
    const bytes = 1_420_000;
    list.unshift({ name, url: URL.createObjectURL(new Blob(["mock jpg"], { type: "image/jpeg" })), bytes, at: new Date().toISOString(), kind: "image" });
    exportsOf.set(id, list);
    return { name, url: list[0]!.url, width: p.size.width * 3, height: p.size.height * 3, bytes, overBudget: false } satisfies QuickExport;
  },
  async listExports(id) {
    return structuredClone(exportsOf.get(id) ?? []) as ExportFile[];
  },
  async deleteExport(id, name) {
    exportsOf.set(id, (exportsOf.get(id) ?? []).filter((f) => f.name !== name));
  },
  async faceStatus(id) {
    const p = need(id);
    const ids = [...new Set(p.assets.filter((a) => a.kind === "face" && a.faceId).map((a) => a.faceId!))];
    const faces = ids.map((fid) => ({ id: fid, state: refreshedFaces.has(`${id}:${fid}`) ? ("current" as const) : ("stale" as const), assets: p.assets.filter((a) => a.faceId === fid).map((a) => a.name) }));
    return { faces, stale: faces.filter((f) => f.state === "stale").length } satisfies FaceStatus;
  },
  async refreshFaces(id) {
    const p = need(id);
    await wait(1600);
    const refreshed = p.assets.filter((a) => a.kind === "face").map((a) => a.name);
    for (const a of p.assets) if (a.faceId) refreshedFaces.add(`${id}:${a.faceId}`);
    const n = addVersion(p);
    p.versions.at(-1)!.note = "faces refreshed";
    p.messages.push({ role: "assistant", text: `Refreshed the face from your face pack (${refreshed.join(", ")}). Nothing else changed.`, at: new Date().toISOString(), version: n });
    touch(p);
    return { project: strip(p), version: n, refreshed, skipped: [] } satisfies RefreshResult;
  },
  async faceUsage(faceId) {
    return [...projects.values()].filter((p) => p.assets.some((a) => a.faceId === faceId)).map((p) => ({ id: p.id, title: p.title, stale: !refreshedFaces.has(`${p.id}:${faceId}`), busy: p.running })) satisfies FaceUsage[];
  },
  async refreshFaceEverywhere(faceId) {
    const results = [];
    for (const u of await this.faceUsage(faceId)) {
      if (!u.stale) continue;
      const r = await this.refreshFaces(u.id);
      results.push({ id: u.id, title: u.title, ok: true, version: r.version });
    }
    return { results };
  },
  async faceVariants(id, body) {
    const src = need(id);
    const picks = body.faces ?? faces.filter((f) => f.stage === "ready" && !f.hidden && f.id !== "00000001").slice(0, body.count ?? 3).map((f) => f.id);
    const setId = `${src.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${(++counter).toString(36)}v`;
    const concepts: ConceptView[] = [];
    for (const [i, fid] of picks.entries()) {
      const pf = needFace(fid);
      const label = `${pf.labels?.expression ?? "Other"} face`.replace(/^./, (c) => c.toUpperCase());
      const copyId = `${src.id.replace(/-[a-z0-9]{3,5}$/, "")}-${(++counter).toString(36)}f`;
      const now = new Date().toISOString();
      const copy: MockProject = { ...structuredClone(src), id: copyId, title: `${src.title} · ${pf.labels?.expression ?? "other"} face`, createdAt: now, updatedAt: now, sessionId: null, starred: false, running: false, conceptSet: { id: setId, index: i, archetype: null, label } };
      copy.assets = copy.assets.map((a) => (a.kind === "face" ? { ...a, name: `face-${fid}-sticker.png`, faceId: fid } : a));
      projects.set(copyId, copy);
      concepts.push({ index: i, forTitle: null, face: fid, faceThumb: pf.retouch.thumbUrl ?? pf.cutout.thumbUrl, projectId: copyId, removed: false, state: "waiting", error: null, archetype: null, label, idea: `The same design with the owner's ${pf.labels?.expression ?? "other"} face (looking ${pf.labels?.gaze ?? "camera"}).`, text: null, why: "Only the face changes.", frame: null, title: copy.title, current: copy.current ?? 0, versionCount: copy.versions.length, running: false, renderUrl: null, checks: { ok: 0, warn: 0, info: 0, warnings: [] }, progress: null });
    }
    const now = new Date().toISOString();
    const view: ConceptSetView = { id: setId, kind: "faces", titles: null, picked: null, source: { projectId: id, removed: false, title: src.title, renderUrl: src.current ? src.renders[src.current]! : null }, title: `${src.title} · other faces`, format: "video", state: "designing", createdAt: now, updatedAt: now, count: concepts.length, kit: null, plan: { source: null, note: "" }, costUsd: 0, testCompare: true, concepts };
    sets.set(setId, { view, draftFiles: 0 });
    pushSet(setId);
    void Promise.all(concepts.map((c, i) => designConcept(setId, c, i * 400)));
    return structuredClone(view);
  },
  async pickConcept(setId, projectId) {
    const m = sets.get(setId)!;
    m.view.picked = projectId;
    need(projectId).starred = true;
    pushSet(setId);
    return structuredClone(m.view);
  },
  async testCompare(id, ids) {
    await wait(900);
    const m = sets.get(id)!;
    const chosen = m.view.concepts.filter((c) => c.renderUrl && (!ids || ids.includes(c.projectId))).slice(0, 3);
    const files = chosen.map((c, n) => ({ name: `thumbnail-${n + 1}.jpg`, width: 3840, height: 2160, bytes: 1_400_000 + n * 90_000, quality: 88, overBudget: false, project: c.projectId }));
    return { name: `${id}-test-and-compare.zip`, url: URL.createObjectURL(new Blob(["mock zip"], { type: "application/zip" })), bytes: files.reduce((a, f) => a + f.bytes, 0), files } satisfies ZipExport;
  },
  async platformExport(id, platforms) {
    await wait(700);
    const all: PlatformId[] = platforms?.length ? platforms : ["youtube-shorts", "instagram-reels", "tiktok"];
    const files = all.map((platform) => ({ platform, name: `${id}-${platform}.jpg`, width: platform === "youtube-shorts" ? 2160 : 1080, height: platform === "youtube-shorts" ? 3840 : 1920, bytes: platform === "youtube-shorts" ? 1_700_000 : 600_000, quality: 90, overBudget: false }));
    return { name: all.length === 1 ? files[0]!.name : `${id}-covers.zip`, url: URL.createObjectURL(new Blob(["mock"], { type: "application/zip" })), bytes: files.reduce((a, f) => a + f.bytes, 0), files };
  },

  capabilities: async () => (await wait(150), structuredClone(caps)),
  presets: async () => PRESETS,
  async listProjects(q = {}) {
    const words = (q.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const by = {
      edited: (a: MockProject, b: MockProject) => b.updatedAt.localeCompare(a.updatedAt),
      newest: (a: MockProject, b: MockProject) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a: MockProject, b: MockProject) => a.createdAt.localeCompare(b.createdAt),
      title: (a: MockProject, b: MockProject) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
    }[q.sort ?? "edited"];
    const all = [...projects.values()]
      .filter((p) => (!q.preset || p.preset === q.preset) && (!q.series || (q.series === "none" ? !p.series : p.series === q.series)) && (!q.starred || p.starred))
      .filter((p) => words.every((w) => `${p.title} ${Object.values(p.brief).join(" ")}`.toLowerCase().includes(w)))
      .sort(by);
    await wait(120);
    const items = all.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 40)).map<ProjectSummary>((p) => ({
      id: p.id, title: p.title, preset: p.preset, size: p.size, series: p.series ?? null, starred: p.starred === true,
      createdAt: p.createdAt, updatedAt: p.updatedAt, versionCount: p.versions.length, current: p.current ?? 0, conceptSet: p.conceptSet ?? null,
      thumbnail: p.current ? p.renders[p.current]! : null,
    }));
    return { items, total: all.length };
  },
  async patchProject(id, patch) {
    const p = need(id);
    if (patch.title !== undefined) p.title = patch.title.trim() || p.title;
    if (patch.starred !== undefined) p.starred = patch.starred;
    if (patch.series !== undefined) p.series = patch.series;
    emit(id, { type: "project", project: strip(p) });
    return strip(p);
  },
  async duplicateProject(id) {
    const p = need(id);
    const copyId = `${p.id.replace(/-[a-z0-9]{3,5}$/, "")}-${(++counter).toString(36)}c`;
    const now = new Date().toISOString();
    const copy: MockProject = { ...structuredClone(p), id: copyId, title: `${p.title.replace(/ \(copy\)$/, "")} (copy)`, createdAt: now, updatedAt: now, sessionId: null, starred: false, running: false };
    projects.set(copyId, copy);
    return strip(copy);
  },
  async newInStyle(id, body) {
    const p = need(id);
    if (!p.series) {
      const sid = `${p.id}-series`;
      series.set(sid, { id: sid, name: p.title, createdAt: new Date().toISOString(), styleProjectId: p.id });
      p.series = sid;
    }
    const made = await this.createProject({ preset: p.preset, title: body.title, size: p.size, brief: { ...p.brief, ...body.brief }, series: p.series });
    const m = projects.get(made.id)!;
    m.series = p.series;
    return strip(m);
  },
  async bulk(action, ids, to) {
    const changed: string[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const p = projects.get(id);
      if (action === "restore") {
        const gone = trash.get(id);
        if (gone) {
          projects.set(id, gone);
          trash.delete(id);
          changed.push(id);
        } else missing.push(id);
        continue;
      }
      if (!p) {
        missing.push(id);
        continue;
      }
      if (action === "delete") {
        trash.set(id, p);
        projects.delete(id);
      } else if (action === "series") p.series = to ?? null;
      else p.starred = action === "star";
      changed.push(id);
    }
    return { ok: true, changed, missing };
  },
  exportZipUrl: (ids) => URL.createObjectURL(new Blob([`mock zip of ${ids.join(", ")}`], { type: "application/zip" })),
  async listSeries() {
    return [...series.values()].map((s) => ({ ...s, count: [...projects.values()].filter((p) => p.series === s.id).length }));
  },
  async createSeries(name) {
    const s: Series = { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(++counter).toString(36)}`, name, createdAt: new Date().toISOString() };
    series.set(s.id, s);
    return s;
  },
  async updateSeries(id, patch) {
    const s = series.get(id);
    if (!s) throw new ApiError("NOT_FOUND", "No such series.", 404);
    if (patch.name) s.name = patch.name;
    return s;
  },
  async deleteSeries(id) {
    series.delete(id);
    for (const p of projects.values()) if (p.series === id) p.series = null;
  },
  async createProject(body: CreateBody) {
    const fmt = body.preset === "thumbnail" ? THUMBNAIL_FORMATS.find((f) => f.id === body.brief.format) : undefined;
    const size = fmt?.size ?? body.size ?? SIZES[body.preset]!;
    const sizeAuto = body.preset === "photo" && !body.size;
    const id = `${(body.title || body.preset).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}-${(++counter).toString(36)}m`;
    const now = new Date().toISOString();
    const p: MockProject = {
      schemaVersion: 1, id, title: body.title || PRESETS.find((x) => x.id === body.preset)!.label, preset: body.preset,
      size, createdAt: now, updatedAt: now, sessionId: null, brief: body.brief as Record<string, string>, assets: [], messages: [],
      versions: [], current: null, running: false, renders: {}, sizeAuto, series: body.series ?? null, starred: false,
    };
    snapshotBrand(p, body.brand);
    projects.set(id, p);
    await wait(300);
    return strip(p);
  },
  getProject: async (id) => strip(need(id)),
  deleteProject: async (id) => void projects.delete(id),
  async uploadAsset(id, file) {
    const p = need(id);
    await wait(500);
    const dims = await createImageBitmap(file).catch(() => null);
    const a: AssetInfo = { name: file.name, kind: "upload", width: dims?.width ?? 800, height: dims?.height ?? 800, from: null };
    // Like the server: a photo project sized by the first upload and brief.aspect.
    if (p.sizeAuto && !p.assets.some((x) => x.kind === "upload")) p.size = photoSize(a, p.brief.aspect ?? "original");
    p.assets.push(a);
    return { name: a.name, width: a.width, height: a.height };
  },
  async cutout(id, name) {
    const p = need(id);
    await wait(2200);
    const src = p.assets.find((a) => a.name === name);
    const out = name.replace(/\.[^.]+$/, "") + "-cutout.png";
    p.assets.push({ name: out, kind: "cutout", width: src?.width ?? 800, height: src?.height ?? 800, from: name });
    return { name: out, width: src?.width ?? 800, height: src?.height ?? 800 };
  },
  async sendMessage(id, text, opts) {
    const p = need(id);
    if (p.running) throw new ApiError("TURN_RUNNING", "A turn is already running.", 409);
    const mode: TurnMode = opts?.mode === "further" ? "further" : "standard";
    const model = mode === "further" ? MODEL_IDS[opts?.model ?? "opus"] : MODEL_IDS.standard;
    const said = text.trim() || (mode === "further" ? FURTHER_DIRECTION : "");
    if (!said) throw new ApiError("EMPTY", "text is required.", 400);
    p.messages.push({ role: "user", text: said, at: new Date().toISOString(), version: null, mode, model });
    p.running = true;
    touch(p);
    void runTurn(p, said, mode, model);
  },
  async cancel(id) {
    cancelled.add(id);
  },
  async restore(id, version) {
    const p = need(id);
    p.current = version;
    touch(p);
    return strip(p);
  },
  async exportProject(id, { format, scale }) {
    const p = need(id);
    await wait(700);
    const width = Math.round(p.size.width * scale);
    const height = Math.round(p.size.height * scale);
    // A tiny real file so the download path can be exercised.
    const url = URL.createObjectURL(new Blob([`mock export ${format} ${width}x${height}`], { type: "text/plain" }));
    const credits = p.assets.filter((a) => a.credit).map((a) => ({ name: a.name, credit: a.credit!, license: a.license ?? "", licenseUrl: a.licenseUrl ?? "", source: a.source ?? "" }));
    return { name: `${p.id}-${width}x${height}.${format}`, url, width, height, bytes: width * height, credits };
  },
  subscribe(id, onEvent) {
    let set = listeners.get(id);
    if (!set) listeners.set(id, (set = new Set()));
    set.add(onEvent);
    const t = setTimeout(() => {
      const p = projects.get(id);
      if (p) onEvent({ type: "snapshot", project: strip(p) });
    }, 0);
    return () => {
      clearTimeout(t);
      set!.delete(onEvent);
    };
  },
  async listFaces() {
    await wait(120);
    return faceList();
  },
  async uploadFace(file) {
    await wait(350);
    const id = (++faceCounter).toString(16).padStart(8, "0");
    const dims = await createImageBitmap(file).catch(() => null);
    const f: FaceView = {
      id, addedAt: new Date().toISOString(), filename: file.name, stage: "queued", error: "",
      original: { width: dims?.width ?? 1600, height: dims?.height ?? 1200, url: "" },
      cutout: { state: "queued", width: null, height: null, url: null, thumbUrl: null },
      labels: null, labelsEditedByOwner: false, mirrorAllowed: null, quality: null, starred: false, hidden: false, retouch: noRetouch(),
    };
    faces.unshift(f);
    advanceFace(f);
    return structuredClone(f);
  },
  async patchFace(id, patch: FacePatch) {
    const f = needFace(id);
    if (patch.starred !== undefined) f.starred = patch.starred;
    if (patch.hidden !== undefined) f.hidden = patch.hidden;
    if (patch.mirrorAllowed !== undefined) f.mirrorAllowed = patch.mirrorAllowed;
    if (patch.retouch !== undefined) f.retouch.override = patch.retouch;
    if (patch.retouchStrength !== undefined) f.retouch.ownStrength = patch.retouchStrength;
    if (patch.retouch !== undefined || patch.retouchStrength !== undefined) startRetouch(f);
    if (patch.labels) {
      f.labels = { ...(f.labels ?? sampleLabels(0)), ...patch.labels };
      f.labelsEditedByOwner = true;
      if (f.stage === "unclassified") f.stage = "ready";
      f.quality ??= { grade: "hd", faceHeightPx: 700, sharpness: 80 };
    }
    return structuredClone(f);
  },
  async deleteFace(id) {
    const i = faces.findIndex((f) => f.id === id);
    if (i >= 0) trashed.set(id, faces.splice(i, 1)[0]!);
  },
  async restoreFace(id) {
    const f = trashed.get(id);
    if (!f) throw new ApiError("NOT_FOUND", "That face is not in the trash.", 404);
    trashed.delete(id);
    faces.unshift(f);
    return structuredClone(f);
  },
  async reclassifyFaces(ids) {
    const changed: string[] = [];
    const skipped: string[] = [];
    for (const f of faces) {
      if (ids && !ids.includes(f.id)) continue;
      if (f.labelsEditedByOwner || f.cutout.state !== "done") skipped.push(f.id);
      else {
        f.stage = "classifying";
        changed.push(f.id);
        setTimeout(() => finishClassify(f, f.id.endsWith("7") ? "fail" : "ok"), 1600);
      }
    }
    return { changed, skipped };
  },
  async recutFace(id) {
    const f = needFace(id);
    f.stage = "queued";
    f.error = "";
    advanceFace(f);
    return structuredClone(f);
  },
  async setFaceSettings(settings) {
    faceSettings = { ...faceSettings, ...settings };
    return faceSettings;
  },
  async retouchFaces(ids) {
    const changed: string[] = [];
    const skipped: string[] = [];
    for (const f of faces) {
      if (ids && !ids.includes(f.id)) continue;
      if (f.retouch.override === false || f.cutout.state !== "done") skipped.push(f.id);
      else {
        startRetouch(f, true);
        changed.push(f.id);
      }
    }
    return { changed, skipped };
  },
  feedUrl: () => "",
  renderUrl: (id, n) => projects.get(id)?.renders[n] ?? "",
  designUrl(id, _nonce) {
    const p = projects.get(id);
    const { width: w, height: h } = p?.size ?? SIZES.thumbnail!;
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:linear-gradient(135deg,#0b3d37,#00bcab);font:800 ${h / 6}px sans-serif;color:#fff"><div style="padding:${h / 10}px">${esc(p?.title ?? "")}<br><span style="font-size:${h / 14}px;opacity:.7">drafting…</span></div></body></html>`;
    return URL.createObjectURL(new Blob([html], { type: "text/html" }));
  },
  assetUrl: () => "",
};

/** Same rule as the server's photoSize: long edge at most 2160. */
function photoSize(source: Size, aspect: string): Size {
  const cap = 2160;
  if (aspect === "original" || !/^\d+:\d+$/.test(aspect)) {
    const k = Math.min(1, cap / Math.max(source.width, source.height));
    return { width: Math.max(1, Math.round(source.width * k)), height: Math.max(1, Math.round(source.height * k)) };
  }
  const [a, b] = aspect.split(":").map(Number) as [number, number];
  const long = Math.min(cap, Math.max(source.width, source.height));
  return a >= b ? { width: long, height: Math.round((long * b) / a) } : { width: Math.round((long * a) / b), height: long };
}

// ---- the face pack (stand-in): a few drawn faces, and uploads that walk through cutting out and classifying ----
let faceCounter = 100;
let faceSettings: FaceSettings = { mirrorAll: true, retouchAll: true, retouchStrength: 0.5 };
const trashed = new Map<string, FaceView>();
const needFace = (id: string) => {
  const f = faces.find((x) => x.id === id);
  if (!f) throw new ApiError("NOT_FOUND", "No such face.", 404);
  return f;
};
function sampleLabels(n: number): FaceLabels {
  return {
    expression: EXPRESSIONS[n % EXPRESSIONS.length]!, intensity: ((n % 3) + 1) as 1 | 2 | 3, gesture: GESTURES[(n * 5) % GESTURES.length]!, gaze: GAZES[n % GAZES.length]!,
    headTurn: n % 3 === 2 ? "three-quarter" : "frontal", eyesOpen: true, textOrLogoInShot: n % 5 === 3, description: `Mock photo number ${n + 1}`,
    faceBox: { x: 0.3, y: 0.1, w: 0.3, h: 0.5 },
  };
}
const MOUTHS: Record<string, string> = {
  smile: "M62 112 Q80 126 98 112", laugh: "M58 108 Q80 140 102 108 Z", surprise: "M72 112 a8 11 0 1 0 16 0 a8 11 0 1 0 -16 0", shock: "M70 108 a10 15 0 1 0 20 0 a10 15 0 1 0 -20 0",
  excited: "M58 106 Q80 138 102 106 Z", thinking: "M68 116 L92 112", sceptical: "M64 116 Q80 108 96 116", confused: "M64 116 Q72 108 80 116 T96 116",
  intense: "M64 114 L96 114", angry: "M64 120 Q80 106 96 120", sad: "M64 120 Q80 106 96 120", neutral: "M66 115 L94 115",
};
function faceArt(n: number, expression: string, retouched = false): string {
  const hue = (n * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="200" viewBox="0 0 160 200"><path d="M10 200 Q10 150 80 148 Q150 150 150 200Z" fill="hsl(${hue} 45% 38%)"/><ellipse cx="80" cy="82" rx="46" ry="56" fill="${retouched ? "hsl(26 50% 78%)" : "hsl(10 60% 62%)"}"/><path d="M34 72 Q40 22 80 24 Q122 22 126 72 Q110 44 80 46 Q52 44 34 72Z" fill="hsl(25 35% 22%)"/><circle cx="62" cy="82" r="${expression === "shock" || expression === "surprise" ? 7 : 5}" fill="#1b1b1b"/><circle cx="98" cy="82" r="${expression === "shock" || expression === "surprise" ? 7 : 5}" fill="#1b1b1b"/><path d="${MOUTHS[expression] ?? MOUTHS.neutral}" fill="${expression === "laugh" || expression === "excited" ? "#7a1f2b" : "none"}" stroke="#7a1f2b" stroke-width="4" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
function seedFace(n: number, over: Partial<FaceView> = {}): FaceView {
  const labels = sampleLabels(n);
  const art = faceArt(n, labels.expression);
  const grade = (["4k", "hd", "soft"] as const)[n % 3]!;
  return {
    id: (n + 1).toString(16).padStart(8, "0"), addedAt: new Date(Date.now() - n * 3_600_000).toISOString(), filename: `me-${n + 1}.jpg`, stage: "ready", error: "",
    original: { width: 4000, height: 3000, url: art }, cutout: { state: "done", width: 4000, height: 3000, url: art, thumbUrl: art },
    labels, labelsEditedByOwner: false, mirrorAllowed: null, quality: { grade, faceHeightPx: [1500, 800, 380][n % 3]!, sharpness: 120 }, starred: n === 0 || n === 4, hidden: false,
    retouch: { ...noRetouch(), state: "done", appliedStrength: 0.5, url: faceArt(n, labels.expression, true), thumbUrl: faceArt(n, labels.expression, true) }, ...over,
  };
}
const noRetouch = (): FaceView["retouch"] => ({ enabled: true, override: null, strength: 0.5, ownStrength: null, state: "none", appliedStrength: null, error: "", url: null, thumbUrl: null });
/** A retouch takes a moment; the drawn faces get a lighter skin tone once it is done. */
function startRetouch(f: FaceView, force = false) {
  const wanted = f.retouch.override ?? faceSettings.retouchAll;
  const strength = f.retouch.ownStrength ?? faceSettings.retouchStrength;
  if (!wanted || f.cutout.state !== "done" || (!force && f.retouch.state === "done" && f.retouch.appliedStrength === strength)) return;
  f.retouch.state = "queued";
  setTimeout(() => (f.retouch.state = "running"), 200);
  setTimeout(() => {
    const n = Number.parseInt(f.id, 16);
    const art = faceArt(n, f.labels?.expression ?? sampleLabels(n).expression, true);
    f.retouch = { ...f.retouch, state: "done", appliedStrength: f.retouch.ownStrength ?? faceSettings.retouchStrength, url: art, thumbUrl: art };
  }, 1400);
}
const faces: FaceView[] = [
  ...Array.from({ length: 12 }, (_, n) => seedFace(n)),
  seedFace(12, { stage: "unclassified", error: "Not classified: expression is missing or outside the vocabulary.", labels: null, quality: null }),
  seedFace(13, { stage: "classifying", labels: null, quality: null }),
];
function faceList(): FaceList {
  const items = structuredClone(faces);
  for (const f of items) {
    f.retouch.enabled = f.retouch.override ?? faceSettings.retouchAll;
    f.retouch.strength = f.retouch.ownStrength ?? faceSettings.retouchStrength;
  }
  const retouching = items.filter((f) => f.retouch.enabled && ["queued", "running"].includes(f.retouch.state)).length;
  return {
    items,
    counts: { total: items.length, ready: items.filter((f) => f.stage === "ready").length, hidden: items.filter((f) => f.hidden).length, working: items.filter((f) => ["queued", "cutting", "classifying"].includes(f.stage)).length + retouching, retouching, unclassified: items.filter((f) => f.stage === "unclassified").length },
    model: "claude-haiku-5-5",
    settings: faceSettings,
  };
}
function finishClassify(f: FaceView, how: "ok" | "fail") {
  if (how === "fail") {
    f.stage = f.labels ? "ready" : "unclassified";
    f.error = f.labels ? "" : "Not classified: Claude gave no labels for this photo.";
    return;
  }
  const n = Number.parseInt(f.id, 16);
  f.labels = sampleLabels(n);
  f.quality = { grade: (["4k", "hd", "soft"] as const)[n % 3]!, faceHeightPx: [1500, 800, 380][n % 3]!, sharpness: 100 };
  f.stage = "ready";
  f.error = "";
}
/** Queued, then cut out (a couple of seconds), then classified. */
function advanceFace(f: FaceView) {
  const speed = Number(new URLSearchParams(location.search).get("speed")) || 1;
  setTimeout(() => {
    f.stage = "cutting";
    f.cutout.state = "running";
  }, 300 / speed);
  setTimeout(() => {
    const n = Number.parseInt(f.id, 16);
    const art = faceArt(n, sampleLabels(n).expression);
    f.cutout = { state: "done", width: f.original.width, height: f.original.height, url: art, thumbUrl: art };
    f.original.url = art;
    f.stage = "classifying";
    startRetouch(f);
  }, 2200 / speed);
  setTimeout(() => finishClassify(f, "ok"), 4200 / speed);
}
