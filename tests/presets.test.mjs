import assert from "node:assert/strict";
import { test } from "node:test";
import { photoSize } from "../server/presets/index.mjs";

test("an aspect crop fits inside the photo and never upscales it", () => {
  assert.deepEqual(photoSize({ width: 1280, height: 719 }, "4:5"), { width: 575, height: 719 });
  assert.deepEqual(photoSize({ width: 1280, height: 719 }, "9:16"), { width: 404, height: 719 });
});

test("a large photo is capped at a 2160 px long edge", () => {
  assert.deepEqual(photoSize({ width: 6000, height: 4000 }, "original"), { width: 2160, height: 1440 });
  assert.deepEqual(photoSize({ width: 6000, height: 4000 }, "4:5"), { width: 1728, height: 2160 });
});

import {
  GRAPHIC_SIZES, MAX_SIDE, MIN_SIDE, MAX_EXPORT_EDGE, PHOTO_ASPECTS, PHOTO_ASPECT_LABELS, PRESETS, THUMBNAIL_FORMATS, allowedScales, buildSystemPrompt, presetById,
} from "../server/presets/index.mjs";

test("graphic sizes are grouped, unique, in bounds and cover the platforms", () => {
  assert.equal(new Set(GRAPHIC_SIZES.map((s) => s.id)).size, GRAPHIC_SIZES.length);
  for (const s of GRAPHIC_SIZES) {
    assert.ok(s.group && s.label, s.id);
    for (const d of [s.width, s.height]) assert.ok(Number.isInteger(d) && d >= MIN_SIDE && d <= MAX_SIDE, `${s.id} ${d}`);
  }
  const groups = new Set(GRAPHIC_SIZES.map((s) => s.group));
  for (const g of ["Instagram", "Facebook", "X / Twitter", "LinkedIn", "YouTube", "TikTok", "Pinterest", "Twitch", "Discord", "Web", "Print (150 dpi)", "Screens"]) assert.ok(groups.has(g), g);
  const by = Object.fromEntries(GRAPHIC_SIZES.map((s) => [s.id, `${s.width}x${s.height}`]));
  assert.equal(by.a4, "1240x1754");
  assert.equal(by.poster, "2700x3600");
  assert.equal(by["ig-story"], "1080x1920");
  assert.ok(presetById("graphic").sizes.some((s) => s.id === "custom" && s.width === null));
});

test("photo aspects include the common ratios, each with a friendly label", () => {
  for (const a of ["3:2", "2:3", "4:3", "3:4", "21:9"]) assert.ok(PHOTO_ASPECTS.includes(a), a);
  for (const a of PHOTO_ASPECTS) assert.ok(PHOTO_ASPECT_LABELS[a], a);
  assert.deepEqual(photoSize({ width: 3000, height: 2000 }, "3:2"), { width: 2160, height: 1440 });
  assert.deepEqual(photoSize({ width: 3000, height: 2000 }, "21:9"), { width: 2160, height: 926 });
});

test("thumbnail formats map to YouTube's three shapes at 3x", () => {
  const f = Object.fromEntries(THUMBNAIL_FORMATS.map((x) => [x.id, x]));
  assert.deepEqual([f.video.width * 3, f.video.height * 3], [3840, 2160]);
  assert.deepEqual([f.shorts.width * 3, f.shorts.height * 3], [2160, 3840]);
  assert.deepEqual([f.podcast.width * 3, f.podcast.height * 3], [3840, 3840]);
  const project = { preset: "thumbnail", size: f.shorts, brief: { format: "shorts" }, assets: [] };
  assert.match(buildSystemPrompt(project), /Shorts thumbnail, 9:16 vertical/);
  assert.equal(PRESETS.find((p) => p.id === "thumbnail").briefFields.at(-1).id, "format");
});

test("export scales are guarded to an 8192 px long edge", () => {
  assert.equal(MAX_EXPORT_EDGE, 8192);
  assert.deepEqual(allowedScales({ width: 1280, height: 1280 }), [1, 1.5, 2, 3]);
  assert.deepEqual(allowedScales({ width: 2700, height: 3600 }), [1, 1.5, 2]);
  assert.deepEqual(allowedScales({ width: 4096, height: 4096 }), [1, 1.5, 2]);
  assert.deepEqual(allowedScales({ width: 3000, height: 3000 }), [1, 1.5, 2]);
});

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PLATFORMS, THUMBNAIL_ARCHETYPES, briefPlatforms, conceptSection, describeConcept, installCraft, plannerSection,
} from "../server/presets/index.mjs";

const root = path.resolve(import.meta.dirname, "..");
const thumb = { preset: "thumbnail", size: { width: 720, height: 1280 }, assets: [] };

test("installCraft copies the thumbnail craft files into reference/craft and replaces stale ones", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "imago-craft-"));
  try {
    await mkdir(path.join(dir, "reference", "craft"), { recursive: true });
    await writeFile(path.join(dir, "reference", "style-reference.html"), "keep");
    await writeFile(path.join(dir, "reference", "craft", "stale.md"), "old");
    assert.equal(await installCraft(thumb, dir), true);
    const base = path.join(dir, "reference", "craft", "thumbnail");
    for (const f of ["index.md", "honesty-and-title.md", "face-finishing.md", "vertical.md", "square.md", "judging.md", "kit.md"]) assert.ok(existsSync(path.join(base, f)), f);
    for (const id of THUMBNAIL_ARCHETYPES) assert.ok(existsSync(path.join(base, "archetypes", `${id}.md`)), id);
    assert.ok(!existsSync(path.join(dir, "reference", "craft", "stale.md")));
    assert.equal(await readFile(path.join(dir, "reference", "style-reference.html"), "utf8"), "keep");
    assert.equal(await installCraft({ preset: "graphic" }, dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every archetype file has the same sections and the index names every craft file", () => {
  const base = path.join(root, "server", "presets", "craft", "thumbnail");
  for (const id of THUMBNAIL_ARCHETYPES) {
    const md = readFileSync(path.join(base, "archetypes", `${id}.md`), "utf8");
    for (const h of ["## Fits when", "## Layout", "16:9", "9:16", "1:1", "## Text", "## Fails when"]) assert.ok(md.includes(h), `${id}: ${h}`);
  }
  const index = readFileSync(path.join(base, "index.md"), "utf8");
  for (const f of readdirSync(base).filter((n) => n.endsWith(".md") && n !== "index.md")) assert.ok(index.includes(f), f);
  for (const id of THUMBNAIL_ARCHETYPES) assert.ok(index.includes(`\`${id}\``), id);
  const judging = readFileSync(path.join(base, "judging.md"), "utf8");
  for (const id of ["text.words", "text.repeatsTitle", "text.smallest", "text.contrast", "layout.badge", "layout.safe", "subject.size", "image.contrast", "image.colourfulness", "feed.distinct"]) assert.ok(judging.includes(`\`${id}\``), id);
  assert.match(readFileSync(path.join(base, "vertical.md"), "utf8"), /accessed 2026-10-13/);
});

test("the thumbnail system prompt is lean and points at the craft files", () => {
  const prompt = buildSystemPrompt({ ...thumb, size: { width: 1280, height: 720 }, brief: {} }, ["Anton", "Archivo"]);
  assert.match(prompt, /reference\/craft\/thumbnail\/index\.md/);
  assert.match(prompt, /archetypes\/<id>\.md/);
  assert.match(prompt, /feed mock-up/);
  assert.match(prompt, /never\s+restate the title/);
  assert.ok(prompt.length < 8000, `system prompt is ${prompt.length} characters`);
  assert.doesNotMatch(buildSystemPrompt({ preset: "graphic", size: { width: 1080, height: 1080 }, brief: {}, assets: [] }), /craft/);
});

test("platforms add the safe-area line for a vertical cover only", () => {
  const brief = { format: "shorts", platforms: ["tiktok", "instagram-reels", "tiktok", "myspace", 5] };
  assert.deepEqual(briefPlatforms(brief), ["tiktok", "instagram-reels"]);
  const prompt = buildSystemPrompt({ ...thumb, brief });
  assert.match(prompt, /Platforms: TikTok, Instagram Reels\./);
  assert.match(prompt, /3:4 centre crop/);
  assert.match(prompt, /x 48-590, y 190-960/);
  assert.doesNotMatch(buildSystemPrompt({ ...thumb, brief: { format: "shorts" } }), /Platforms:/);
  assert.doesNotMatch(buildSystemPrompt({ ...thumb, brief: { format: "video", platforms: ["tiktok"] } }), /Platforms:/);
  assert.deepEqual(Object.keys(PLATFORMS), ["youtube-shorts", "instagram-reels", "tiktok"]);
});

test("planner and concept prompts fill their placeholders", () => {
  const files = ["planner.md", "concept.md"].map((n) => readFileSync(path.join(root, "server", "presets", n), "utf8"));
  assert.deepEqual([...new Set(files[0].match(/\{\{\w+\}\}/g))].sort(), ["{{count}}", "{{format}}"]);
  assert.deepEqual([...new Set(files[1].match(/\{\{\w+\}\}/g))].sort(), ["{{concept}}", "{{siblings}}"]);
  const planner = plannerSection({ count: 3, format: "shorts" });
  assert.doesNotMatch(planner, /\{\{/);
  assert.match(planner, /Exactly 3 concepts/);
  assert.match(planner, /vertical cover, 9:16/);
  for (const id of THUMBNAIL_ARCHETYPES) assert.ok(planner.includes(id), id);
  assert.match(planner, /concepts\.json/);
  const a = { archetype: "reaction", label: "Shocked first look", idea: "Face left, rocket right", text: "NO WAY", frame: "assets/kit-f03.jpg", pictures: ["assets/kit-rocket.png"], why: "Curiosity." };
  const b = { archetype: "number", label: "The price", idea: "Big 5", text: "$5", why: "Cheap." };
  const section = conceptSection(a, [b]);
  assert.doesNotMatch(section, /\{\{/);
  assert.match(section, /Archetype: reaction/);
  assert.match(section, /Text on the image: "NO WAY"/);
  assert.match(section, /Concept 1\n- Archetype: number/);
  assert.match(conceptSection(a, []), /\(none\)/);
  assert.match(describeConcept(b), /Text on the image: "\$5"/);
});

test("fonts.json lists real, licensed files that fonts.css declares", () => {
  const dir = path.join(root, "fonts");
  const { families } = JSON.parse(readFileSync(path.join(dir, "fonts.json"), "utf8"));
  const css = readFileSync(path.join(dir, "fonts.css"), "utf8");
  assert.equal(new Set(families.map((f) => f.family)).size, families.length);
  for (const f of families) {
    assert.ok(existsSync(path.join(dir, f.file)), f.file);
    assert.ok(css.includes(`font-family: "${f.family}"`) && css.includes(`/fonts/${f.file}`), f.family);
    assert.ok(Array.isArray(f.weights) && f.weights.length >= 1 && f.note, f.family);
  }
  const names = families.map((f) => f.family);
  for (const n of ["Archivo", "Montserrat", "Lilita One", "Bangers", "Permanent Marker", "Bowlby One", "League Gothic"]) assert.ok(names.includes(n), n);
  const licences = readdirSync(path.join(dir, "licenses"));
  assert.ok(licences.length >= 7 && licences.every((n) => /OFL|Apache/.test(n)));
  assert.match(readFileSync(path.join(root, "server", "presets", "design-rules.md"), "utf8"), /Archivo/);
});
