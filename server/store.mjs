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
  function mutate(id, fn) {
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
      const project = await read(id);
      const next = (await fn(project)) ?? project;
      next.updatedAt = new Date().toISOString();
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

  async function create({ preset, title, size, brief = {}, extra = {} }) {
    const now = new Date().toISOString();
    await fs.mkdir(projectsDir, { recursive: true });
    let id = "";
    for (let attempt = 0; ; attempt += 1) {
      id = `${slugify(title)}-${randomBytes(2).toString("hex")}`.slice(0, 64);
      try {
        await fs.mkdir(dirOf(id));
        break;
      } catch (error) {
        if (error.code !== "EEXIST" || attempt >= 5) throw error;
      }
    }
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

  return { create, read, mutate, list, remove, dirOf, clearStaleRunning, projectsDir };
}
