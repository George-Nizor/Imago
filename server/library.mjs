import fs from "node:fs/promises";
import path from "node:path";
import { imageInfo } from "./image-info.mjs";

export const REFERENCE_HTML = "reference/style-reference.html";
export const REFERENCE_PNG = "assets/style-reference.png";
export const SORTS = ["edited", "newest", "oldest", "title"];
export const MAX_PAGE = 200;
export const DEFAULT_PAGE = 40;

const int = (value, fallback, min, max) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Filters, sorts and pages project summaries. `params` is a URLSearchParams. Never mutates `all`. */
export function queryProjects(all, params) {
  const terms = String(params.get("query") ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const preset = params.get("preset");
  const series = params.get("series");
  const starred = ["1", "true"].includes(params.get("starred") ?? "");
  const sort = SORTS.includes(params.get("sort")) ? params.get("sort") : "edited";
  const matches = all.filter(
    (p) =>
      (!preset || p.preset === preset) &&
      (!series || (series === "none" ? !p.series : p.series === series)) &&
      (!starred || p.starred) &&
      terms.every((term) => p.text.includes(term)),
  );
  const by = {
    edited: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
  }[sort];
  matches.sort((a, b) => by(a, b) || a.id.localeCompare(b.id));
  const offset = int(params.get("offset"), 0, 0, 1_000_000);
  const limit = int(params.get("limit"), DEFAULT_PAGE, 1, MAX_PAGE);
  const items = matches.slice(offset, offset + limit).map(({ text: _text, ...card }) => card);
  return { items, total: matches.length };
}

export class StyleReferenceError extends Error {
  constructor(message) {
    super(message);
    this.code = "NO_RENDER";
    this.status = 409;
  }
}

/**
 * Copies `source`'s current render to `target`'s assets/style-reference.png and its design.html to
 * reference/style-reference.html, and registers the image as a "reference" asset.
 */
export async function copyStyleReference(store, sourceId, targetId) {
  const source = await store.read(sourceId);
  const from = store.dirOf(sourceId);
  const to = store.dirOf(targetId);
  const render = path.join(from, "renders", `v${source.current}.png`);
  let png;
  let html;
  try {
    png = await fs.readFile(render);
    html = await fs.readFile(path.join(from, "design.html"));
  } catch {
    throw new StyleReferenceError("That project has no render yet, so there is nothing to copy the style from.");
  }
  await fs.mkdir(path.join(to, "reference"), { recursive: true });
  await fs.writeFile(path.join(to, REFERENCE_HTML), html);
  await fs.writeFile(path.join(to, REFERENCE_PNG), png);
  const info = imageInfo(png);
  await store.mutate(targetId, (p) => {
    p.assets = p.assets.filter((a) => a.name !== "style-reference.png");
    p.assets.push({ name: "style-reference.png", kind: "reference", width: info?.width ?? 0, height: info?.height ?? 0, from: sourceId });
  }, { touch: false });
}

export const hasReference = (store, id) =>
  fs.access(path.join(store.dirOf(id), REFERENCE_HTML)).then(() => true, () => false);
