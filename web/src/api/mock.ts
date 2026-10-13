// A stand-in server for building and screenshotting the UI without the real one. It is used only
// when the page is opened with `?mock=1` (or `?mock=signedout` for the unready panel), or in dev
// with VITE_IMAGO_MOCK=1. It simulates a turn with the same events the server sends and renders
// placeholder images, so nothing here spends a subscription.
import type {
  Api,
  AssetInfo,
  Capabilities,
  Check,
  ConceptSetView,
  ConceptView,
  CreateBody,
  CreateSetBody,
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
  const text = `Make concept ${c.index + 1}`;
  p.messages.push({ role: "user", text, at: new Date().toISOString(), version: null });
  p.title = `${m.view.title} · ${c.label}`;
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

export const mockApi: Api = {
  async listKits() {
    await wait(150);
    return { items: structuredClone(KITS), rejected: [] };
  },
  async createConceptSet(body: CreateSetBody) {
    const kit = kitOf(body.kit);
    const brief: Record<string, string | string[]> = { ...body.brief, ...(kit ? { title: String(body.brief.title || kit.suggested.title) } : {}) };
    const title = body.title || String(brief.title || "Thumbnails");
    const id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${(++counter).toString(36)}s`;
    const format = (String(brief.format ?? kit?.suggested.format ?? "video")) as ConceptSetView["format"];
    const concepts: ConceptView[] = [];
    for (let i = 0; i < body.count; i++) {
      const made = await this.createProject({ preset: "thumbnail", title: `${title} · concept ${i + 1}`, brief: { ...brief, format } });
      const p = projects.get(made.id)!;
      p.conceptSet = { id, index: i, archetype: null, label: null };
      concepts.push({ index: i, projectId: made.id, removed: false, state: "planning", error: null, archetype: null, label: null, idea: null, text: null, why: null, frame: null, title: p.title, current: 0, versionCount: 0, running: false, renderUrl: null, checks: { ok: 0, warn: 0, info: 0, warnings: [] }, progress: null });
    }
    const now = new Date().toISOString();
    const view: ConceptSetView = { id, title, format, state: "draft", createdAt: now, updatedAt: now, count: body.count, kit: kit ? { id: kit.id, title: kit.title } : null, plan: { source: null, note: "" }, costUsd: 0, testCompare: format === "video", concepts };
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
