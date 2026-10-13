// Stages the feed mock-up for the renderer: a temp folder holding the page, this design's render and
// copies of its neighbours (the sandboxed renderer reads nothing outside the page folder).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DECOYS, decoyImage, feedBody } from "./feed-markup.mjs";
import { isProjectId } from "./paths.mjs";

const { rgbToLab } = createRequire(import.meta.url)("../render/measure.cjs");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const NEIGHBOUR_LIMIT = 8;
const MIN_NEIGHBOURS = 6;
const SCAN_LIMIT = 60; // project folders read, newest folders first

/** video | shorts | podcast, from the brief's format or else the canvas shape. */
export function formatOf(project) {
  const named = project?.brief?.format;
  if (["video", "shorts", "podcast"].includes(named)) return named;
  const ratio = (project?.size?.width ?? 16) / (project?.size?.height ?? 9);
  return ratio > 1.4 ? "video" : ratio < 0.8 ? "shorts" : "podcast";
}

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const VIEWS = ["48K views", "212K views", "1.1M views", "9.6K views", "530K views", "76K views"];
const AGES = ["1 day ago", "4 days ago", "2 weeks ago", "3 weeks ago", "2 months ago", "6 days ago"];

/**
 * The owner's other current renders of the same shape, newest first. Skips this project and every
 * project in the same concept set (`conceptSet.id`), and anything without a render on disk.
 */
export async function libraryNeighbours({ projectsDir, projectId, conceptSetId, format, limit = NEIGHBOUR_LIMIT }) {
  let names;
  try {
    names = await fs.readdir(projectsDir);
  } catch {
    return [];
  }
  const dirs = [];
  for (const name of names) {
    if (name === projectId || !isProjectId(name)) continue;
    const stat = await fs.stat(path.join(projectsDir, name)).catch(() => null);
    if (stat?.isDirectory()) dirs.push({ name, at: stat.mtimeMs });
  }
  dirs.sort((a, b) => b.at - a.at);
  const found = [];
  for (const { name } of dirs.slice(0, SCAN_LIMIT)) {
    let p;
    try {
      p = JSON.parse(await fs.readFile(path.join(projectsDir, name, "project.json"), "utf8"));
    } catch {
      continue;
    }
    if (p.preset !== "thumbnail" || p.id !== name || formatOf(p) !== format) continue;
    if (conceptSetId && p.conceptSet?.id === conceptSetId) continue;
    const file = path.join(projectsDir, name, "renders", `v${p.current}.png`);
    if (!p.current || !(await fs.stat(file).then((s) => s.isFile(), () => false))) continue;
    found.push({ file, updatedAt: String(p.updatedAt ?? ""), title: String(p.brief?.title || p.title || "Untitled"), id: name });
  }
  found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return found.slice(0, limit);
}

/** A neutral stand-in thumbnail as an SVG data URI, with its approximate mean colour as Lab. */
function decoy(n, format) {
  const { src, meanRgb } = decoyImage(n, format);
  return { src, meanLab: rgbToLab(...meanRgb) };
}

/**
 * Builds the page folder. Returns {dir, job, source, cleanup}: `job` is what render.cjs --feed reads
 * (it adds thumb.png itself), `source` says whether the neighbours are the owner's own designs.
 */
export async function stageFeed({ config, format, title, projectId, conceptSetId, outFile }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "imago-feed-"));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    const real = await libraryNeighbours({ projectsDir: config.projectsDir, projectId, conceptSetId, format });
    const items = [];
    const jobNeighbours = [];
    for (const [n, r] of real.entries()) {
      const name = `n${n}.png`;
      await fs.copyFile(r.file, path.join(dir, name));
      const h = hash(r.id);
      items.push({ src: name, title: r.title, channel: "Your channel", views: VIEWS[h % 6], age: AGES[(h >> 3) % 6], duration: format === "shorts" ? "" : `${(h % 17) + 3}:${String(h % 60).padStart(2, "0")}` });
      jobNeighbours.push({ file: name });
    }
    for (let n = 0; items.length < MIN_NEIGHBOURS; n += 1) {
      const d = decoy(n, format);
      const meta = DECOYS[n % DECOYS.length];
      items.push({ src: d.src, ...meta, duration: format === "shorts" ? "" : meta.duration });
      // Only decoys that stand in for real neighbours are compared against; with none, all of them are.
      if (!real.length) jobNeighbours.push({ meanLab: d.meanLab });
    }
    const mine = { src: "thumb.png", title: title || "Untitled video", channel: "Your channel", views: "128K views", age: "2 days ago", duration: format === "shorts" ? "" : "12:34" };
    const css = await fs.readFile(path.join(HERE, "feed.css"), "utf8");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Feed</title><link rel="stylesheet" href="/fonts/fonts.css"><style>html,body{margin:0}${css}</style></head><body>${feedBody(format, mine, items)}</body></html>`;
    await fs.writeFile(path.join(dir, "index.html"), html);
    const job = { dir, width: 1568, out: outFile, neighbours: jobNeighbours };
    await fs.writeFile(path.join(dir, "job.json"), JSON.stringify(job));
    return { dir, jobFile: path.join(dir, "job.json"), source: real.length ? "library" : "decoys", cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
