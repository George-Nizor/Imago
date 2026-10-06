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
