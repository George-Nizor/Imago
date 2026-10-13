// Concept sets: N thumbnail concepts for one video. One planning turn (in the set's own folder, so its
// Claude session is never a concept project's) writes concepts.json; then one design turn per
// concept runs in its own project, in parallel up to IMAGO_CONCEPT_CONCURRENCY.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { registerCutout, registerFace } from "./assets.mjs";
import { BRAND_ASSET_PREFIX, copySnapshotFiles, readSnapshot } from "./brands.mjs";
import { STOPWORDS, tokenize } from "./checks.mjs";
import { facesRoot, orderFaces, packSelection, readAllFaces, summarize, usable, readSettings, takeFace } from "./face-pack.mjs";
import { renderFaceSheet } from "./face-sheet.mjs";
import { runPlanner } from "./claude-runner.mjs";
import { fontFamilies } from "./design-files.mjs";
import { kitPromptSection, writeKitFolder } from "./kits.mjs";
import { isProjectId, isSafeLeaf } from "./paths.mjs";
import { THUMBNAIL_ARCHETYPES, buildFirstPrompt } from "./presets/index.mjs";

export class SetError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const MAX_CONCEPTS = THUMBNAIL_ARCHETYPES.length;
export const ARCHETYPE_LABELS = {
  reaction: "Reaction",
  "result-reveal": "Result reveal",
  "before-after": "Before and after",
  versus: "Versus",
  number: "The number",
  "curiosity-gap": "Curiosity gap",
  "object-hero": "Object hero",
  "story-moment": "Story moment",
};
const IDEAS = {
  reaction: "The video's strongest expression, big, with a few words that tease what caused it.",
  "result-reveal": "The result the video delivers, shown at once, with a word that names it.",
  "before-after": "Two real states from the video side by side, with a clear divide.",
  versus: "Two things the video sets against each other, facing off.",
  number: "One number the video gives, huge, with the subject beside it.",
  "curiosity-gap": "A subject looking at or pointing to something the picture withholds.",
  "object-hero": "The one object the video is about, large and clean, with a short word.",
  "story-moment": "A real moment from the video, cropped tight, with a line from the story.",
};
// Fallback order: the archetypes that work from a face first, then those that need pictures.
const FACE_ORDER = ["reaction", "curiosity-gap", "result-reveal", "story-moment", "number", "versus", "before-after", "object-hero"];
const OBJECT_ORDER = ["object-hero", "curiosity-gap", "result-reveal", "number", "story-moment", "reaction", "versus", "before-after"];

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const sameTitle = (a, b) => tokenize(a).join(" ") === tokenize(b).join(" ");

/** Does the words on a thumbnail only say what its title already says? (Every content word of `text` is one of the title's.) */
export function repeatsTitle(text, title) {
  const words = tokenize(text ?? "").filter((w) => !STOPWORDS.has(w));
  const known = new Set(tokenize(title ?? "").filter((w) => !STOPWORDS.has(w)));
  return words.length > 0 && words.every((w) => known.has(w));
}

/**
 * Checks planner output against the plan's schema. `assets` is the set of file names the concepts may
 * point at (without the `assets/` prefix). `titles` (a title A/B test) makes concept N the one for title N: it must
 * echo that title and its words may never repeat it. Returns {ok, concepts} or {ok: false, reason}.
 */
export function validateConcepts(raw, { count, assets, faces = new Set(), requireFace = false, titles = null }) {
  const bad = (reason) => ({ ok: false, reason });
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.concepts)) return bad("concepts.json has no concepts list.");
  if (raw.concepts.length !== count) return bad(`Expected ${count} concepts, found ${raw.concepts.length}.`);
  const seen = new Set();
  const out = [];
  for (const [i, c] of raw.concepts.entries()) {
    const at = `Concept ${i + 1}`;
    if (!c || typeof c !== "object") return bad(`${at} is not an object.`);
    if (!THUMBNAIL_ARCHETYPES.includes(c.archetype)) return bad(`${at} has an unknown archetype.`);
    if (seen.has(c.archetype)) return bad(`${at} repeats the archetype ${c.archetype}.`);
    seen.add(c.archetype);
    const line = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.replace(/\s+/g, " ").trim() : null);
    const label = line(c.label, 40, "label");
    const idea = line(c.idea, 400, "idea");
    const why = line(c.why, 400, "why");
    if (!label || !idea || !why) return bad(`${at} needs a label, an idea and a why of sensible length.`);
    if (typeof c.text !== "string" || c.text.length > 60 || wordCount(c.text) > 4) return bad(`${at}: text must be at most 4 words.`);
    if (titles) {
      if (typeof c.title !== "string" || !sameTitle(c.title, titles[i])) return bad(`${at}: title must be exactly ${JSON.stringify(titles[i])}.`);
      if (repeatsTitle(c.text, titles[i])) return bad(`${at}: the text repeats its title; the words must say what the title does not.`);
    }
    const picture = (p) => typeof p === "string" && p.startsWith("assets/") && isSafeLeaf(p.slice(7)) && assets.has(p.slice(7));
    if (c.frame !== undefined && c.frame !== null && !picture(c.frame)) return bad(`${at}: frame ${JSON.stringify(String(c.frame).slice(0, 60))} is not an asset.`);
    const pictures = c.pictures === undefined || c.pictures === null ? [] : c.pictures;
    if (!Array.isArray(pictures) || pictures.length > 6 || !pictures.every(picture)) return bad(`${at}: pictures must be existing assets.`);
    if (c.face !== undefined && c.face !== null && !(typeof c.face === "string" && faces.has(c.face))) return bad(`${at}: face ${JSON.stringify(String(c.face).slice(0, 20))} is not in the face pack.`);
    if (requireFace && !c.face) return bad(`${at}: the face source is the owner's pack, so every concept needs a pack face.`);
    out.push({ archetype: c.archetype, label, idea, text: c.text.replace(/\s+/g, " ").trim(), ...(titles ? { title: titles[i] } : {}), ...(c.frame ? { frame: c.frame } : {}), ...(c.face ? { face: c.face } : {}), ...(pictures.length ? { pictures } : {}), why });
  }
  return { ok: true, concepts: out };
}

/**
 * Gives concepts that share a pack face different ones where the pack has more to offer. `order` is the
 * pack's face ids, best first. Mutates and returns `concepts`.
 */
export function diversifyFaces(concepts, order) {
  const used = new Set();
  for (const c of concepts) {
    if (!c.face) continue;
    if (used.has(c.face)) {
      const other = order.find((id) => !used.has(id) && !concepts.some((x) => x !== c && x.face === id));
      if (other) c.face = other;
    }
    used.add(c.face);
  }
  return concepts;
}

/**
 * Server-chosen concepts for when the planner's file is missing or invalid, and for "another concept":
 * distinct archetypes (never one in `used`), each on a different face frame where the kit has several.
 */
export function fallbackConcepts({ count, kit = null, records = [], used = [], uploads = [], packFaces = [], preferPack = false, titles = null }) {
  const nameOf = (file) => records.find((r) => r.kitFile === file)?.name;
  const faces = (kit?.frames ?? []).filter((f) => f.kind === "face").sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((f) => nameOf(f.file)).filter(Boolean);
  const screens = (kit?.frames ?? []).filter((f) => f.kind === "screen").map((f) => nameOf(f.file)).filter(Boolean);
  const pictures = (kit?.pictures ?? []).map((p) => nameOf(p.file)).filter(Boolean);
  // With the pack as the face source its faces are used even when the video offers frames or the owner uploaded photos.
  const usePack = preferPack && packFaces.length > 0;
  const people = usePack ? [] : faces.length ? faces : uploads;
  // Otherwise the pack's faces stand in only when the video offers no real frame of a person.
  const fromPack = usePack || (!people.length && packFaces.length > 0);
  const order = (people.length || fromPack ? FACE_ORDER : OBJECT_ORDER).filter((a) => !used.includes(a));
  const rest = THUMBNAIL_ARCHETYPES.filter((a) => !used.includes(a) && !order.includes(a));
  const picks = [...order, ...rest].slice(0, count);
  let turn = used.length; // spreads frames across the whole set, not just this call
  return picks.map((archetype, n) => {
    const pick = (pool) => (pool.length ? `assets/${pool[turn % pool.length]}` : undefined);
    let frame;
    let face;
    const facePick = () => (fromPack ? packFaces[(turn - used.length) % packFaces.length] : undefined);
    let extra = [];
    if (archetype === "object-hero") frame = pick(pictures) ?? pick(screens) ?? pick(people);
    else if (archetype === "before-after" || archetype === "versus") {
      frame = pick(pictures) ?? pick(people);
      if (pictures.length > 1) extra = [`assets/${pictures[(turn + 1) % pictures.length]}`];
    } else if (archetype === "number") frame = pick(screens) ?? pick(people);
    else frame = pick(people) ?? pick(pictures);
    if (fromPack && !(archetype === "object-hero" && frame)) face = facePick();
    turn += 1;
    return {
      archetype,
      label: ARCHETYPE_LABELS[archetype],
      idea: IDEAS[archetype],
      text: null, // the designer chooses the words
      ...(titles ? { title: titles[n] } : {}),
      ...(frame ? { frame } : {}),
      ...(face ? { face } : {}),
      ...(extra.length ? { pictures: extra } : {}),
      why: "Chosen by Imago for its clarity at feed size; the design keeps to what the video shows.",
    };
  });
}

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < max && queue.length) queue.shift()();
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() => {
        active += 1;
        fn().then(resolve, reject).finally(() => {
          active -= 1;
          next();
        });
      });
      next();
    });
}

const slug = (s) => String(s ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "") || "set";
const DONE_STATES = new Set(["done", "failed", "cancelled"]);

/**
 * `ctx`: {config, store, createProject(body, opts), findKit(id), startTurn(id, {text, concept}),
 * abortProject(id), cutOut(projectDir, asset)}.
 */
export function createConceptSets(ctx) {
  const { config, store } = ctx;
  const root = path.join(config.dataDir, "concept-sets");
  const dirOf = (id) => {
    if (!isProjectId(id)) throw new SetError("BAD_ID", "Invalid concept set id.");
    return path.join(root, id);
  };
  const fileOf = (id) => path.join(dirOf(id), "set.json");
  const workOf = (id) => path.join(dirOf(id), "work");
  const limit = createLimiter(Math.max(1, config.conceptConcurrency ?? 3));
  const runs = new Map(); // set id -> AbortController, while the set is being driven
  const byProject = new Map(); // project id -> set id
  const memberIndex = new Map(); // project id -> its index in the set
  const queues = new Map();
  const subscribers = new Map();
  const timers = new Map();

  async function read(id) {
    try {
      return JSON.parse(await fs.readFile(fileOf(id), "utf8"));
    } catch (error) {
      if (error instanceof SetError) throw error;
      if (error.code === "ENOENT") throw new SetError("NOT_FOUND", "No such concept set.", 404);
      throw new SetError("CORRUPT", `set.json could not be read: ${error.message}`, 500);
    }
  }

  function derive(set) {
    if (set.state === "draft") return;
    const states = set.members.map((m) => m.state);
    if (states.includes("planning")) set.state = "planning";
    else if (states.some((s) => s === "waiting" || s === "designing")) set.state = "designing";
    else if (states.includes("done")) set.state = "done";
    else if (states.length && states.every((s) => s === "cancelled")) set.state = "cancelled";
    else set.state = "failed";
  }

  function mutate(id, fn) {
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
      const set = await read(id);
      await fn(set);
      derive(set);
      set.updatedAt = new Date().toISOString();
      const tmp = `${fileOf(id)}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(set, null, 2)}\n`);
      await fs.rename(tmp, fileOf(id));
      scheduleEmit(id);
      return set;
    });
    const tail = run.catch(() => {});
    queues.set(id, tail);
    tail.then(() => queues.get(id) === tail && queues.delete(id));
    return run;
  }

  // ---- the expanded view (what the compare screen reads) ------------------------------------

  async function view(set) {
    const concepts = [];
    for (const m of set.members) {
      let project = null;
      try {
        project = await store.read(m.projectId);
      } catch {
        // Deleted since: shown as removed.
      }
      const current = project?.versions?.find((v) => v.n === project.current);
      const checks = current?.checks ?? [];
      const c = m.concept ?? {};
      concepts.push({
        index: m.index,
        forTitle: m.title ?? null,
        projectId: m.projectId,
        removed: !project,
        state: !project ? "removed" : m.state,
        error: m.error ?? null,
        archetype: c.archetype ?? project?.conceptSet?.archetype ?? null,
        label: c.label ?? project?.conceptSet?.label ?? null,
        idea: c.idea ?? null,
        text: c.text ?? null,
        why: c.why ?? null,
        frame: c.frame ?? null,
        face: c.face ?? null,
        faceThumb: c.face ? `/faces/${c.face}/thumb.png` : null,
        title: project?.title ?? null,
        current: project?.current ?? 0,
        versionCount: project?.versions?.length ?? 0,
        running: project?.running === true,
        renderUrl: project?.current ? `/projects/${m.projectId}/renders/v${project.current}.png` : null,
        checks: {
          ok: checks.filter((k) => k.level === "ok").length,
          warn: checks.filter((k) => k.level === "warn").length,
          info: checks.filter((k) => k.level === "info").length,
          warnings: checks.filter((k) => k.level === "warn").map((k) => ({ id: k.id, message: k.message })),
        },
        progress: m.progress ?? null,
      });
    }
    const source = set.sourceProjectId ? await store.read(set.sourceProjectId).catch(() => null) : null;
    return {
      id: set.id,
      kind: set.kind ?? "concepts",
      titles: set.titles ?? null,
      picked: set.picked ?? null,
      source: set.sourceProjectId ? { projectId: set.sourceProjectId, removed: !source, title: source?.title ?? null, renderUrl: source?.current ? `/projects/${source.id}/renders/v${source.current}.png` : null } : null,
      title: set.title,
      format: set.format,
      state: set.state,
      createdAt: set.createdAt,
      updatedAt: set.updatedAt,
      count: set.count,
      kit: set.kit ?? null,
      brand: set.brand ?? null,
      plan: { source: set.plan?.source ?? null, note: set.plan?.note ?? "" },
      costUsd: Math.round(((set.costUsd ?? 0) + Number.EPSILON) * 10000) / 10000,
      testCompare: set.format === "video",
      concepts,
    };
  }

  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  function broadcast(id, event, data) {
    for (const res of subscribers.get(id) ?? []) res.write(frame(event, data));
  }
  function scheduleEmit(id) {
    if (!subscribers.get(id)?.size || timers.has(id)) return;
    timers.set(
      id,
      setTimeout(async () => {
        timers.delete(id);
        try {
          broadcast(id, "set", { set: await view(await read(id)) });
        } catch {
          // The set may have just been removed.
        }
      }, 120),
    );
  }

  const api = {
    read,
    view: async (id) => view(await read(id)),
    setOf: (projectId) => byProject.get(projectId) ?? null,

    /** SSE: a snapshot now, then `set` after changes and `concept.progress` lines. */
    async subscribe(id, res) {
      const set = await read(id);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`retry: 3000\n${frame("snapshot", { set: await view(set) })}`);
      if (!subscribers.has(id)) subscribers.set(id, new Set());
      subscribers.get(id).add(res);
      return () => {
        subscribers.get(id)?.delete(res);
        if (!subscribers.get(id)?.size) subscribers.delete(id);
      };
    },
    heartbeat() {
      for (const set of subscribers.values()) for (const res of set) res.write(": heartbeat\n\n");
    },

    /** Called with every event of every project; keeps the compare screen live. */
    onProjectEvent(projectId, event, data) {
      const setId = byProject.get(projectId);
      if (!setId) return;
      if (event === "tool.use") {
        broadcast(setId, "concept.progress", { index: memberIndex.get(projectId) ?? -1, text: data.summary });
      } else if (["render.done", "project", "run.finished", "run.error"].includes(event)) scheduleEmit(setId);
    },

    /** Creates the set and its N projects (no turn yet). State: draft. */
    async create({ title, brief, kit, count, format, brand = null, createProject, titles = null }) {
      await fs.mkdir(root, { recursive: true });
      let id;
      for (let attempt = 0; ; attempt += 1) {
        id = `${slug(title)}-${randomBytes(2).toString("hex")}`.slice(0, 64);
        try {
          await fs.mkdir(dirOf(id));
          break;
        } catch (error) {
          if (error.code !== "EEXIST" || attempt >= 5) throw error;
        }
      }
      const work = workOf(id);
      await fs.mkdir(path.join(work, "assets"), { recursive: true });
      const created = [];
      try {
        let sheetFrom;
        if (kit) {
          const written = await writeKitFolder(config, work, kit, { faceSource: brief.faceSource });
          if (written.sheet) sheetFrom = path.join(work, "assets", "kit-contact-sheet.png");
        }
        for (let i = 0; i < count; i += 1) {
          // A title test: each concept is made for its own title, which is its project's title and brief.
          const own = titles ? { ...brief, title: titles[i] } : brief;
          const project = await createProject({ preset: "thumbnail", title: titles ? titles[i].slice(0, 80) : `${title} · concept ${i + 1}`.slice(0, 80), brief: own }, { kit, sheetFrom, brand, extra: { conceptSet: { id, index: i, archetype: null, label: null } } });
          created.push(project.id);
        }
        // The planner gets the same snapshot the concepts did, so it plans in the brand's palette.
        if (brand) await copySnapshotFiles(store.dirOf(created[0]), work);
      } catch (error) {
        for (const pid of created) await store.remove(pid).catch(() => {});
        await fs.rm(dirOf(id), { recursive: true, force: true });
        throw error;
      }
      const now = new Date().toISOString();
      const set = {
        schemaVersion: 1,
        id,
        title,
        format,
        count,
        state: "draft",
        createdAt: now,
        updatedAt: now,
        kit: kit ? { id: kit.id, title: kit.kit.source.title } : null,
        brand: brand ? { id: brand.brand.id, name: brand.brand.name } : null,
        kitAssets: kit ? (await store.read(created[0])).assets.filter((a) => a.kitFile || a.name === "kit-contact-sheet.png") : [],
        brief,
        ...(titles ? { titles } : {}),
        plan: { source: null, note: "", concepts: [] },
        costUsd: 0,
        members: created.map((projectId, index) => ({ index, projectId, state: "planning", error: null, concept: null, ...(titles ? { title: titles[index] } : {}) })),
      };
      await fs.writeFile(fileOf(id), `${JSON.stringify(set, null, 2)}\n`);
      for (const m of set.members) {
        byProject.set(m.projectId, id);
        memberIndex.set(m.projectId, m.index);
      }
      return set;
    },

    /** A draft set takes uploads (face photos): every project gets the file, and the planner's folder. */
    async addUpload(id, filename, bytes, saveUpload) {
      const set = await read(id);
      if (set.state !== "draft") throw new SetError("NOT_DRAFT", "Photos can only be added before the set starts.", 409);
      let first = null;
      for (const m of set.members) {
        const saved = await saveUpload(store, m.projectId, filename, bytes);
        first ??= saved;
      }
      await fs.writeFile(path.join(workOf(id), "assets", first.name), bytes);
      return first;
    },

    /** Starts planning and then the design turns, in the background. */
    async start(id) {
      const set = await read(id);
      if (set.state !== "draft") throw new SetError("ALREADY_STARTED", "This set has already started.", 409);
      const ctl = new AbortController();
      runs.set(id, ctl);
      await mutate(id, (s) => void (s.state = "planning"));
      void drive(id, ctl)
        .catch(async (error) => {
          await mutate(id, (s) => {
            for (const m of s.members) if (!DONE_STATES.has(m.state)) Object.assign(m, { state: "failed", error: String(error?.message ?? error) });
          }).catch(() => {});
        })
        .finally(() => runs.delete(id));
      return api.view(id);
    },

    async cancel(id) {
      const set = await read(id);
      runs.get(id)?.abort();
      for (const m of set.members) ctx.abortProject(m.projectId);
      if (!runs.has(id)) {
        await mutate(id, (s) => {
          if (s.state === "draft") s.state = "planning";
          for (const m of s.members) if (!DONE_STATES.has(m.state)) m.state = "cancelled";
        });
      }
      return api.view(id);
    },

    /** One more concept with an archetype not used yet, designed from the others as siblings. */
    async another(id) {
      const set = await read(id);
      if (set.titles) throw new SetError("NOT_SUPPORTED", "A title test has one concept per title; start another test to try more titles.", 409);
      if (set.kind === "faces") throw new SetError("NOT_SUPPORTED", "A set of other faces cannot take another concept.", 409);
      if (runs.has(id) || ["draft", "planning", "designing"].includes(set.state)) throw new SetError("SET_BUSY", "Wait for the set to finish first.", 409);
      const used = set.members.map((m) => m.concept?.archetype ?? m.archetype).filter(Boolean);
      if (set.members.length >= MAX_CONCEPTS || used.length >= MAX_CONCEPTS) throw new SetError("TOO_MANY", `A set holds at most ${MAX_CONCEPTS} concepts, one per archetype.`, 409);
      const kit = await kitOf(set);
      const taken = set.members.map((m) => m.concept?.face).filter(Boolean);
      const [concept] = fallbackConcepts({ count: 1, kit, records: set.kitAssets ?? [], used, uploads: await uploadsOf(set), packFaces: (await packOrder()).filter((f) => !taken.includes(f)).concat(taken), preferPack: set.brief?.faceSource === "pack" });
      const donor = await donorOf(set);
      const index = Math.max(-1, ...set.members.map((m) => m.index)) + 1;
      const created = await ctx.createProject(
        { preset: "thumbnail", title: `${set.title} · ${concept.label}`.slice(0, 80), brief: set.brief },
        { kit: null, extra: { conceptSet: { id, index, archetype: concept.archetype, label: concept.label } }, cloneFrom: donor },
      );
      const ctl = new AbortController();
      runs.set(id, ctl);
      byProject.set(created.id, id);
      memberIndex.set(created.id, index);
      await mutate(id, (s) => {
        s.members.push({ index, projectId: created.id, state: "waiting", error: null, concept });
        s.plan.concepts.push(concept);
        s.count = s.members.length;
      });
      void (async () => {
        const fresh = await read(id);
        const siblings = fresh.members.filter((m) => m.index !== index).map((m) => m.concept).filter(Boolean);
        await designMember(id, fresh, fresh.members.find((m) => m.index === index), siblings, ctl);
      })()
        .catch(() => {})
        .finally(() => runs.delete(id));
      return api.view(id);
    },

    /**
     * A set of "the same design with another face": the source project's copies already exist (`members[].projectId`, each with its
     * new face in place) and each gets one locked-down face-swap turn, in parallel under the concept limit. The set starts at once
     * (there is no planner). `members`: [{projectId, concept, text}].
     */
    async createFaceVariants({ title, format, source, members, brief = {} }) {
      await fs.mkdir(root, { recursive: true });
      let id;
      for (let attempt = 0; ; attempt += 1) {
        id = `${slug(title)}-${randomBytes(2).toString("hex")}`.slice(0, 64);
        try {
          await fs.mkdir(dirOf(id));
          break;
        } catch (error) {
          if (error.code !== "EEXIST" || attempt >= 5) throw error;
        }
      }
      const now = new Date().toISOString();
      const set = {
        schemaVersion: 1,
        kind: "faces",
        id,
        title,
        format,
        count: members.length,
        state: "designing",
        createdAt: now,
        updatedAt: now,
        sourceProjectId: source,
        kit: null,
        brand: null,
        kitAssets: [],
        brief,
        plan: { source: "faces", note: "", concepts: members.map((m) => m.concept) },
        costUsd: 0,
        members: members.map((m, index) => ({ index, projectId: m.projectId, state: "waiting", error: null, concept: m.concept, task: m.text })),
      };
      await fs.writeFile(fileOf(id), `${JSON.stringify(set, null, 2)}\n`);
      for (const m of set.members) {
        byProject.set(m.projectId, id);
        memberIndex.set(m.projectId, m.index);
      }
      return set;
    },

    /** Runs a face-variant set's turns in the background. */
    async startFaceVariants(id) {
      const set = await read(id);
      const ctl = new AbortController();
      runs.set(id, ctl);
      void Promise.allSettled(set.members.map((m) => runMember(id, m, ctl, { text: m.task, kind: "face-swap" }))).finally(() => runs.delete(id));
      return api.view(id);
    },

    /** The owner's choice from a set: the project is starred and remembered as the pick; the others stay in the library. */
    async pick(id, projectId) {
      const set = await read(id);
      if (!set.members.some((m) => m.projectId === projectId)) throw new SetError("NOT_A_MEMBER", "That project is not part of this set.", 400);
      await store.mutate(projectId, (p) => void (p.starred = true), { touch: false });
      await mutate(id, (s) => void (s.picked = projectId));
      return api.view(id);
    },

    /** A crash leaves sets half done; nothing runs at start-up. Also indexes the projects. */
    async recover() {
      for (const name of await fs.readdir(root).catch(() => [])) {
        if (!isProjectId(name)) continue;
        try {
          const set = await read(name);
          for (const m of set.members) {
            byProject.set(m.projectId, name);
            memberIndex.set(m.projectId, m.index);
          }
          if (["planning", "designing"].includes(set.state)) {
            await mutate(name, (s) => {
              for (const m of s.members) if (!DONE_STATES.has(m.state)) Object.assign(m, { state: "failed", error: "Imago was restarted while this was running." });
            });
          }
        } catch {
          // A folder without a readable set.json is not a set.
        }
      }
    },
    mutate,
    dirOf,
    abortAll() {
      for (const ctl of runs.values()) ctl.abort();
    },
  };


  /** Usable pack face ids, best first. */
  async function packOrder() {
    return orderFaces(await readAllFaces(config.dataDir)).map((f) => f.id);
  }

  /** The planner's view of the pack: a capped sheet, thumbnails and faces.json under work/faces/. Returns the face count shown. */
  async function stagePack(work) {
    const all = await readAllFaces(config.dataDir);
    const chosen = packSelection(all, 24);
    if (!chosen.length) return 0;
    const settings = await readSettings(config.dataDir);
    const dir = path.join(work, "faces");
    await fs.mkdir(dir, { recursive: true });
    const items = [];
    for (const f of chosen) {
      const thumb = path.join(facesRoot(config.dataDir), f.id, f.cutout.thumb ? "thumb.png" : "cutout.png");
      await fs.copyFile(thumb, path.join(dir, `${f.id}.png`));
      items.push({ file: path.join(dir, `${f.id}.png`), label: f.id, caption: `${f.labels.expression} ${f.labels.intensity} · looks ${f.labels.gaze} · ${f.quality?.grade ?? "?"}${f.starred ? " · starred" : ""}` });
    }
    const sheet = await renderFaceSheet(config, items, { out: path.join(dir, "sheet.png"), columns: 6, cell: 200, title: `The owner's face pack: ${chosen.length} of ${all.filter(usable).length}` });
    const summary = { total: all.filter(usable).length, shown: chosen.length, sheet: sheet ? "faces/sheet.png" : null, faces: chosen.map((f, i) => ({ n: i + 1, file: `faces/${f.id}.png`, ...summarize(f, settings) })) };
    await fs.writeFile(path.join(dir, "faces.json"), `${JSON.stringify(summary, null, 2)}\n`);
    return chosen.length;
  }

  async function kitOf(set) {
    if (!set.kit) return null;
    for (const m of set.members) {
      try {
        return JSON.parse(await fs.readFile(path.join(store.dirOf(m.projectId), "reference", "kit.json"), "utf8"));
      } catch {
        // Try the next project.
      }
    }
    return null;
  }
  async function uploadsOf(set) {
    for (const m of set.members) {
      try {
        return (await store.read(m.projectId)).assets.filter((a) => a.kind === "upload").map((a) => a.name);
      } catch {
        // Try the next project.
      }
    }
    return [];
  }
  async function donorOf(set) {
    for (const m of set.members) {
      try {
        await store.read(m.projectId);
        return m.projectId;
      } catch {
        // Gone; try the next.
      }
    }
    throw new SetError("NO_PROJECTS", "Every concept of this set has been deleted.", 409);
  }

  // ---- driving a set ---------------------------------------------------------------------------

  async function planStep(set, ctl) {
    const work = workOf(set.id);
    const kit = await kitOf(set);
    const uploads = (await fs.readdir(path.join(work, "assets")).catch(() => [])).filter((n) => !n.startsWith("kit-") && !n.startsWith(BRAND_ASSET_PREFIX));
    const packShown = await stagePack(work);
    const usableIds = new Set((await readAllFaces(config.dataDir)).filter(usable).map((f) => f.id));
    const packFaces = (await packOrder());
    const faceSource = set.brief?.faceSource;
    const requireFace = faceSource === "pack" && packShown > 0;
    const titles = set.titles ?? null;
    const text = [
      titles ? `This is a title A/B test of ${titles.length} titles: ${titles.map((t, i) => `${i + 1}. ${JSON.stringify(t)}`).join("; ")}. Plan one thumbnail concept per title, in that order, each with its own idea; read the "Title A/B test" part of your instructions.` : "",
      `Plan ${set.count} different thumbnail concepts for this video and write concepts.json.`,
      requireFace ? `Every concept must set "face" to a different pack id (read faces/sheet.png and faces/faces.json) whose expression and gesture match that concept's emotion, whose gaze points toward the side the text will take (or a face that can be mirrored: mirrorSafe, and the pack setting allows it), and of the best quality grade that fits.` : "",
      packShown ? `The owner has a face pack of ${usableIds.size} of their own faces: read faces/sheet.png and faces/faces.json, and set "face" on a concept to a pack id when no better real frame exists.` : "",
      uploads.length ? `The owner uploaded ${uploads.map((u) => `assets/${u}`).join(", ")} (face photos or pictures to build on).` : "",
    ].filter(Boolean).join(" ");
    const names = Object.fromEntries((set.kitAssets ?? []).filter((a) => a.kitFile).map((a) => [a.kitFile, a.name]));
    const grades = Object.fromEntries((set.kitAssets ?? []).filter((a) => a.kitFile && a.quality?.grade).map((a) => [a.kitFile, a.quality.grade]));
    const kitText = kit ? kitPromptSection(kit, { contactSheet: (set.kitAssets ?? []).some((a) => a.name === "kit-contact-sheet.png"), fonts: fontFamilies(config.fontsDir), names, faceSource, grades }) : "";
    const prompt = buildFirstPrompt({ preset: "thumbnail", brief: titles ? { ...set.brief, title: titles.map((t) => `"${t}"`).join(" or ") } : set.brief }, text, kitText);
    await fs.rm(path.join(work, "concepts.json"), { force: true });
    const outcome = await runPlanner({
      config,
      dir: work,
      prompt,
      count: set.count,
      format: set.format,
      titles,
      brand: await readSnapshot(work),
      signal: ctl.signal,
      onTool: (summary) => broadcast(set.id, "set.progress", { text: summary }),
    });
    // Brand files sit in the folder for the planner to look at; they are not pictures from the video.
    const assets = new Set((await fs.readdir(path.join(work, "assets")).catch(() => [])).filter((n) => !n.startsWith(BRAND_ASSET_PREFIX)));
    const fallback = (note) => ({
      source: "fallback",
      note,
      cost: outcome.costUsd,
      concepts: fallbackConcepts({ count: set.count, kit, records: set.kitAssets ?? [], uploads, packFaces, preferPack: faceSource === "pack", titles }),
    });
    if (!outcome.ok) {
      if (outcome.failure.code === "CANCELLED" || ["CLAUDE_MISSING", "CLAUDE_SIGNED_OUT"].includes(outcome.failure.code)) return { failure: outcome.failure, cost: outcome.costUsd };
      return fallback(`The planning turn failed (${outcome.failure.message}), so Imago chose the concepts.`);
    }
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(work, "concepts.json"), "utf8"));
    } catch {
      return fallback("The planner wrote no readable concepts.json, so Imago chose the concepts.");
    }
    const checked = validateConcepts(parsed, { count: set.count, assets, faces: usableIds, requireFace, titles });
    if (!checked.ok) return fallback(`The planner's concepts were not usable (${checked.reason}), so Imago chose the concepts.`);
    return { source: "planner", note: "", cost: outcome.costUsd, concepts: diversifyFaces(checked.concepts, packFaces) };
  }

  /** One cut_out per chosen face frame (or upload); the result is copied to the projects that use it. */
  async function precut(set) {
    const wanted = new Map(); // asset name -> member ids
    const first = await store.read(set.members[0].projectId).catch(() => null);
    if (!first) return new Map();
    for (const m of set.members) {
      const name = m.concept?.frame?.replace(/^assets\//, "");
      const rec = first.assets.find((a) => a.name === name);
      if (!rec || !(rec.kitKind === "face" || rec.kind === "upload")) continue;
      wanted.set(name, [...(wanted.get(name) ?? []), m]);
    }
    const made = new Map(); // member index -> cut-out name
    for (const [name, users] of wanted) {
      broadcast(set.id, "set.progress", { text: `Cutting out ${name}` });
      try {
        const home = users[0];
        const result = await ctx.cutOut(store.dirOf(home.projectId), name);
        await registerCutout(store, home.projectId, result);
        for (const m of users) {
          if (m !== home) {
            await fs.copyFile(path.join(store.dirOf(home.projectId), "assets", result.name), path.join(store.dirOf(m.projectId), "assets", result.name));
            await registerCutout(store, m.projectId, result);
          }
          made.set(m.index, result.name);
        }
      } catch {
        // The designer can still run cut_out itself.
      }
    }
    return made;
  }

  /** Copies the concept's pack face into its project, registered as a face, before its design turn. */
  async function placeFace(member) {
    const face = member.concept?.face;
    if (!face) return null;
    try {
      const made = await takeFace(config.dataDir, store.dirOf(member.projectId), face);
      await registerFace(store, member.projectId, { name: made.name, width: made.width, height: made.height, faceId: face, stamp: made.stamp });
      return made.name;
    } catch {
      return null; // the designer can still find_faces and use_face itself
    }
  }

  async function designMember(id, set, member, siblings, ctl, cutout) {
    if (!member) return;
    const concept = member.concept;
    const faceName = await placeFace(member);
    const text = [
      `Make concept ${member.index + 1} of ${set.members.length}: "${concept.label}" (${concept.archetype}). Your instructions describe it; execute it.`,
      cutout ? `A cut-out of its main picture is ready: assets/${cutout} (background already removed).` : "",
      faceName ? `Its face is assets/${faceName}, from the owner's face pack (already cut out; use_face with mirror gives the other-facing copy when allowed). Respect its quality grade and match its gaze to the text side.` : "",
    ].filter(Boolean).join(" ");
    await runMember(id, member, ctl, { text, concept: { concept, siblings } });
  }

  /** One member's turn, under the concurrency limit; records its outcome and cost. A failure never touches the others. */
  async function runMember(id, member, ctl, turn) {
    await limit(async () => {
      if (ctl.signal.aborted) return mutate(id, (s) => void Object.assign(s.members.find((m) => m.index === member.index) ?? {}, { state: "cancelled" }));
      await mutate(id, (s) => void Object.assign(s.members.find((m) => m.index === member.index) ?? {}, { state: "designing" }));
      let result;
      try {
        result = await ctx.startTurn(member.projectId, turn);
      } catch (error) {
        result = { ok: false, failure: { code: error.code ?? "EXITED", message: String(error?.message ?? error) }, costUsd: 0 };
      }
      const cancelled = result.failure?.code === "CANCELLED";
      await mutate(id, (s) => {
        const m = s.members.find((x) => x.index === member.index);
        if (m) Object.assign(m, { state: result.ok ? "done" : cancelled ? "cancelled" : "failed", error: result.ok ? null : result.failure?.message ?? null, progress: null });
        s.costUsd = (s.costUsd ?? 0) + (result.costUsd ?? 0);
      });
    });
  }

  async function drive(id, ctl) {
    let set = await read(id);
    const plan = await planStep(set, ctl);
    if (plan.failure) {
      const cancelled = plan.failure.code === "CANCELLED";
      await mutate(id, (s) => {
        s.costUsd = (s.costUsd ?? 0) + (plan.cost ?? 0);
        for (const m of s.members) Object.assign(m, { state: cancelled ? "cancelled" : "failed", error: cancelled ? null : plan.failure.message });
      });
      return finishPlanning(id);
    }
    await mutate(id, (s) => {
      s.plan = { source: plan.source, note: plan.note, concepts: plan.concepts };
      s.costUsd = (s.costUsd ?? 0) + (plan.cost ?? 0);
      s.members.forEach((m, i) => Object.assign(m, { state: "waiting", concept: plan.concepts[i] }));
    });
    set = await read(id);
    await Promise.all(
      set.members.map((m) =>
        store
          .mutate(m.projectId, (p) => {
            p.conceptSet = { ...p.conceptSet, archetype: m.concept.archetype, label: m.concept.label };
            if (!set.titles) p.title = `${set.title} · ${m.concept.label}`.slice(0, 80);
          }, { touch: false })
          .catch(() => {}),
      ),
    );
    await finishPlanning(id);
    const cutouts = ctl.signal.aborted ? new Map() : await precut(set);
    set = await read(id);
    const concepts = set.members.map((m) => m.concept);
    await Promise.allSettled(
      set.members.map((m, i) =>
        designMember(id, set, m, concepts.filter((_, j) => j !== i), ctl, cutouts.get(m.index)),
      ),
    );
  }

  /** The planner's folder holds copies of the kit; once the plan is made only concepts.json is worth keeping. */
  async function finishPlanning(id) {
    const work = workOf(id);
    for (const sub of ["assets", "reference", "faces"]) await fs.rm(path.join(work, sub), { recursive: true, force: true }).catch(() => {});
  }

  return api;
}
