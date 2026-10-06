import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "./paths.mjs";

export class SeriesError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const slug = (name) =>
  String(name ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "series";

const clean = (name) => (typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 60) : "");

/** `<dataDir>/series.json`: [{id, name, createdAt, styleProjectId?}]. Missing or damaged means none. */
export async function readSeriesFile(dataDir) {
  try {
    const list = JSON.parse(await fs.readFile(path.join(dataDir, "series.json"), "utf8"));
    return Array.isArray(list) ? list.filter((s) => s && isProjectId(s.id) && typeof s.name === "string") : [];
  } catch {
    return [];
  }
}

/** Series metadata, with every change serialised and written atomically. */
export function createSeriesStore(dataDir) {
  const file = path.join(dataDir, "series.json");
  let queue = Promise.resolve();

  function change(fn) {
    const run = queue.then(async () => {
      const list = await readSeriesFile(dataDir);
      const result = await fn(list);
      await fs.mkdir(dataDir, { recursive: true });
      const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`);
      await fs.rename(tmp, file);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  const styleId = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (!isProjectId(value)) throw new SeriesError("BAD_STYLE_PROJECT", "styleProjectId must be a project id.");
    return value;
  };

  return {
    list: () => readSeriesFile(dataDir),
    async get(id) {
      return (await readSeriesFile(dataDir)).find((s) => s.id === id) ?? null;
    },
    create({ name, styleProjectId } = {}) {
      const title = clean(name);
      if (!title) throw new SeriesError("BAD_NAME", "A series needs a name.");
      const style = styleId(styleProjectId);
      return change((list) => {
        if (list.some((s) => s.name.toLowerCase() === title.toLowerCase())) throw new SeriesError("EXISTS", `There is already a series called "${title}".`, 409);
        let id = slug(title);
        while (list.some((s) => s.id === id)) id = `${slug(title)}-${randomBytes(2).toString("hex")}`.slice(0, 64);
        const series = { id, name: title, createdAt: new Date().toISOString(), ...(style && { styleProjectId: style }) };
        list.push(series);
        return series;
      });
    },
    update(id, { name, styleProjectId } = {}) {
      const title = name === undefined ? undefined : clean(name);
      if (title === "") throw new SeriesError("BAD_NAME", "A series needs a name.");
      const style = styleProjectId === null ? null : styleId(styleProjectId);
      return change((list) => {
        const series = list.find((s) => s.id === id);
        if (!series) throw new SeriesError("NOT_FOUND", "No such series.", 404);
        if (title !== undefined) {
          if (list.some((s) => s.id !== id && s.name.toLowerCase() === title.toLowerCase())) throw new SeriesError("EXISTS", `There is already a series called "${title}".`, 409);
          series.name = title;
        }
        if (style === null) delete series.styleProjectId;
        else if (style) series.styleProjectId = style;
        return series;
      });
    },
    remove(id) {
      return change((list) => {
        const at = list.findIndex((s) => s.id === id);
        if (at < 0) throw new SeriesError("NOT_FOUND", "No such series.", 404);
        list.splice(at, 1);
      });
    },
  };
}
