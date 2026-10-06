#!/usr/bin/env node
// Fills an IMAGO_DATA_DIR with fake projects for looking at the Library: node tests/fixtures/seed-library.mjs <dataDir> [count]
// Thumbnails are small generated PNGs; projects in the same series share a palette and layout, so a series reads as one channel.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createStore } from "../../server/store.mjs";
import { createSeriesStore } from "../../server/series.mjs";
import { crc32 } from "../../server/zip.mjs";

const [dataDir, countArg] = process.argv.slice(2);
if (!dataDir) {
  console.error("usage: seed-library.mjs <dataDir> [count]");
  process.exit(2);
}
const count = Number(countArg) || 60;

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
function png(width, height, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) raw.set(pixel(x / width, y / height), row + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const SERIES = [
  { name: "Rocket Channel", top: [8, 30, 90], bottom: [228, 87, 46], accent: [255, 214, 80] },
  { name: "Garden Diaries", top: [14, 70, 50], bottom: [150, 210, 90], accent: [255, 255, 255] },
  { name: "Chess in Minutes", top: [30, 24, 40], bottom: [120, 80, 200], accent: [0, 225, 200] },
];
const TOPICS = ["Rocket", "Garden", "Chess", "Pasta", "Budget", "Moon", "Robot", "Bike", "Sourdough", "Piano"];
const SIZES = { thumbnail: [1280, 720], shorts: [720, 1280], graphic: [1080, 1080] };

const projectsDir = path.join(path.resolve(dataDir), "projects");
fs.mkdirSync(projectsDir, { recursive: true });
const store = createStore(projectsDir);
const seriesStore = createSeriesStore(path.resolve(dataDir));
for (const s of SERIES) s.id = (await seriesStore.create({ name: s.name }).catch(async () => (await seriesStore.list()).find((x) => x.name === s.name))).id;

for (let i = 0; i < count; i += 1) {
  const series = i % 4 === 3 ? null : SERIES[i % 3];
  const kind = i % 13 === 5 ? "shorts" : i % 7 === 3 ? "graphic" : "thumbnail";
  const preset = kind === "graphic" ? "graphic" : "thumbnail";
  const [w, h] = SIZES[kind];
  const title = `${TOPICS[i % TOPICS.length]} ${["secrets", "mistakes", "in 10 minutes", "for beginners", "gone wrong"][i % 5]} ${i + 1}`;
  const brief = preset === "graphic" ? { description: `A poster about ${title}` } : { title, format: kind === "shorts" ? "shorts" : "video", channelColours: series ? series.name : "" };
  const p = await store.create({ preset, title, size: { width: w, height: h }, brief });
  const dir = store.dirOf(p.id);
  const palette = series ?? { top: [20, 40, 60], bottom: [200, 160, 120], accent: [255, 255, 255] };
  const versions = 1 + (i % 4);
  const subject = [0.55 + 0.1 * Math.sin(i), 0.5 + 0.08 * Math.cos(i * 1.7)];
  const image = png(320, Math.round((320 * h) / w), (x, y) => {
    let c = mix(palette.top, palette.bottom, y);
    // The channel's text bar sits in the same place in every episode; the subject moves.
    if (x > 0.05 && x < 0.55 && y > 0.62 && y < 0.8) c = palette.accent;
    if (x > 0.05 && x < 0.4 && y > 0.82 && y < 0.88) c = mix(palette.accent, palette.top, 0.4);
    const dx = (x - subject[0]) * (w / h), dy = y - subject[1] + 0.05;
    if (dx * dx + dy * dy < 0.045) c = mix(palette.accent, [255, 255, 255], 0.5 + 0.4 * Math.sin(i * 2.3));
    return c;
  });
  for (let v = 1; v <= versions; v += 1) {
    fs.writeFileSync(path.join(dir, "renders", `v${v}.png`), image);
    fs.writeFileSync(path.join(dir, "versions", `v${v}.html`), "<html></html>");
  }
  fs.writeFileSync(path.join(dir, "design.html"), `<html><body>${title}</body></html>`);
  const at = new Date(Date.now() - (i * 5 + (i % 3)) * 3_600_000).toISOString();
  await store.mutate(
    p.id,
    (x) => {
      x.versions = Array.from({ length: versions }, (_, k) => ({ n: k + 1, at, warnings: [] }));
      x.current = versions;
      x.createdAt = new Date(Date.now() - (i * 5 + 40) * 3_600_000).toISOString();
      x.updatedAt = at;
      x.series = series?.id ?? null;
      x.starred = i % 9 === 0;
      x.sessionId = "seeded";
      x.briefSent = true;
    },
    { touch: false },
  );
}
console.log(`Seeded ${count} projects and ${SERIES.length} series in ${dataDir}`);
