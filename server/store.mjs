import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "./paths.mjs";

const SCHEMA = 1;

export class StoreError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function slugify(title) {
  const slug = String(title ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "project";
}

/**
 * Project folders and project.json. The server is the only writer of project.json; writes are
 * serialised per project and land atomically (temp file, then rename).
 */
export function createStore(projectsDir) {
  const queues = new Map();

  const dirOf = (id) => {
    if (!isProjectId(id)) throw new StoreError("BAD_ID", "Invalid project id.", 400);
    return path.join(projectsDir, id);
  };
  const fileOf = (id) => path.join(dirOf(id), "project.json");

  async function read(id) {
    try {
      return JSON.parse(await fs.readFile(fileOf(id), "utf8"));
    } catch (error) {
      if (error instanceof StoreError) throw error;
      if (error.code === "ENOENT") throw new StoreError("NOT_FOUND", "No such project.", 404);
      throw new StoreError("CORRUPT", `project.json could not be read: ${error.message}`, 500);
    }
  }

  async function write(project) {
    const file = fileOf(project.id);
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(project, null, 2)}\n`);
    await fs.rename(tmp, file);
  }

  /** Read-modify-write one project under its queue; `fn` may mutate and/or return a replacement. */
  function mutate(id, fn, { touch = true } = {}) {
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
      const project = await read(id);
      const next = (await fn(project)) ?? project;
      if (touch) next.updatedAt = new Date().toISOString();
      await write(next);
      return next;
    });
    const tail = run.catch(() => {});
    queues.set(id, tail);
    // Drop the entry once its chain has settled, unless a later write already replaced it.
    tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return run;
  }

  /** Claims a fresh folder named after `title` (slug plus a random suffix) and returns its id. */
  async function claimId(title) {
    await fs.mkdir(projectsDir, { recursive: true });
    for (let attempt = 0; ; attempt += 1) {
      const id = `${slugify(title)}-${randomBytes(2).toString("hex")}`.slice(0, 64);
      try {
        await fs.mkdir(dirOf(id));
        return id;
      } catch (error) {
        if (error.code !== "EEXIST" || attempt >= 5) throw error;
      }
    }
  }

  async function create({ preset, title, size, brief = {}, extra = {} }) {
    const now = new Date().toISOString();
    const id = await claimId(title);
    for (const sub of ["assets", "versions", "renders", "exports"]) await fs.mkdir(path.join(dirOf(id), sub));
    const project = {
      schemaVersion: SCHEMA,
      id,
      title: title || "Untitled",
      preset,
      size,
      createdAt: now,
      updatedAt: now,
      sessionId: null,
      briefSent: false,
      brief,
      assets: [],
      messages: [],
      versions: [],
      current: 0,
      running: false,
      series: null,
      starred: false,
      ...extra,
    };
    await write(project);
    return project;
  }

  async function list() {
    let entries = [];
    try {
      entries = await fs.readdir(projectsDir);
    } catch {
      return [];
    }
    const projects = [];
    for (const id of entries) {
      if (!isProjectId(id)) continue;
      try {
        projects.push(await read(id));
      } catch {
        // A folder without a readable project.json is not a project.
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function remove(id) {
    await read(id);
    await queues.get(id);
    queues.delete(id);
    await fs.rm(dirOf(id), { recursive: true, force: true });
  }

  /** A crash can leave `running: true` behind; nothing runs at start-up. */
  async function clearStaleRunning() {
    for (const project of await list()) {
      if (project.running) await mutate(project.id, (p) => void (p.running = false)).catch(() => {});
    }
  }

  // ---- library: compact summaries, copies and the trash --------------------------------------

  // id -> {key, summary}: a summary is rebuilt only when project.json's mtime or size changed, so
  // listing hundreds of projects does not re-parse hundreds of conversations every time.
  const summaryCache = new Map();

  async function summaryOf(id) {
    const file = fileOf(id);
    const stat = await fs.stat(file);
    const key = `${stat.mtimeMs}:${stat.size}`;
    const hit = summaryCache.get(id);
    if (hit?.key === key) return hit.summary;
    const p = JSON.parse(await fs.readFile(file, "utf8"));
    const summary = {
      id: p.id,
      title: String(p.title ?? ""),
      preset: p.preset,
      size: p.size,
      series: typeof p.series === "string" ? p.series : null,
      starred: p.starred === true,
      createdAt: p.createdAt ?? p.updatedAt ?? "",
      updatedAt: p.updatedAt ?? "",
      versionCount: Array.isArray(p.versions) ? p.versions.length : 0,
      current: Number.isInteger(p.current) ? p.current : 0,
      thumbnail: p.current > 0 ? `/projects/${p.id}/renders/v${p.current}.png` : null,
      // For search only; the route strips it.
      text: [p.title, ...Object.values(p.brief ?? {}).filter((v) => typeof v === "string")].join("\n").toLowerCase(),
    };
    summaryCache.set(id, { key, summary });
    return summary;
  }

  /** Every project as a compact summary (unsorted). A folder without a readable project.json is skipped. */
  async function summaries() {
    const entries = await fs.readdir(projectsDir).catch(() => []);
    const out = [];
    await Promise.all(
      entries.filter(isProjectId).map(async (id) => {
        try {
          out.push(await summaryOf(id));
        } catch {
          summaryCache.delete(id);
        }
      }),
    );
    return out;
  }

  /** Copies a project folder (versions, renders and assets included) under a new id. No session, no history lock. */
  async function duplicate(id, title) {
    const source = await read(id);
    await queues.get(id);
    const copyId = await claimId(title);
    try {
      await fs.cp(dirOf(id), dirOf(copyId), { recursive: true, filter: (from) => !from.endsWith(".tmp") });
      const now = new Date().toISOString();
      const copy = {
        ...(await read(id)),
        id: copyId,
        title,
        createdAt: now,
        updatedAt: now,
        sessionId: null,
        briefSent: false,
        running: false,
        starred: false,
        duplicatedFrom: source.id,
      };
      await write(copy);
      return copy;
    } catch (error) {
      await fs.rm(dirOf(copyId), { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  const trashDir = path.join(projectsDir, ".trash");
  const TRASH_DAYS = 7;

  /** Moves a project folder into .trash/ (undoable until it is purged). */
  async function trash(id) {
    await read(id);
    await queues.get(id);
    queues.delete(id);
    await fs.mkdir(trashDir, { recursive: true });
    const dest = path.join(trashDir, id);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.rename(dirOf(id), dest);
    await fs.writeFile(path.join(trashDir, `${id}.json`), JSON.stringify({ deletedAt: new Date().toISOString() }));
    summaryCache.delete(id);
  }

  /** Puts a trashed project back; false when it is not in the trash or its id has been taken. */
  async function untrash(id) {
    if (!isProjectId(id)) return false;
    const from = path.join(trashDir, id);
    try {
      await fs.access(from);
      await fs.access(dirOf(id)).then(() => Promise.reject(new StoreError("EXISTS", "That id is in use.", 409)), () => {});
      await fs.rename(from, dirOf(id));
    } catch {
      return false;
    }
    await fs.rm(path.join(trashDir, `${id}.json`), { force: true });
    return true;
  }

  /** Deletes trashed projects older than seven days. */
  async function purgeTrash(now = Date.now()) {
    let purged = 0;
    for (const name of await fs.readdir(trashDir).catch(() => [])) {
      if (!isProjectId(name)) continue;
      let deletedAt = 0;
      try {
        deletedAt = Date.parse(JSON.parse(await fs.readFile(path.join(trashDir, `${name}.json`), "utf8")).deletedAt);
      } catch {
        deletedAt = (await fs.stat(path.join(trashDir, name)).catch(() => null))?.mtimeMs ?? 0;
      }
      if (now - deletedAt > TRASH_DAYS * 86_400_000) {
        await fs.rm(path.join(trashDir, name), { recursive: true, force: true });
        await fs.rm(path.join(trashDir, `${name}.json`), { force: true });
        purged += 1;
      }
    }
    return purged;
  }

  return { create, read, mutate, list, remove, dirOf, clearStaleRunning, projectsDir, summaries, duplicate, trash, untrash, purgeTrash };
}
