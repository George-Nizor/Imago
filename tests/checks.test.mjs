import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { LIMITS, computeChecks, overlapShare, tokenize } from "../server/checks.mjs";

const { pixelStats, backdropLuminance, contrastRatio, relativeLuminance, deltaE, rgbToLab } = createRequire(import.meta.url)("../render/measure.cjs");

const block = (words, rect, extra = {}) => ({ words, rect, fontSize: 100, capHeight: 70, color: [255, 255, 255, 1], opacity: 1, outlined: false, backdrop: 0.02, ...extra });
const pixels = { spread: 0.7, colourfulness: 40, meanLab: [50, 10, 10], lumaP5: 0.1, lumaP95: 0.8 };
const measure = (over = {}) => ({ canvas: { w: 1280, h: 720 }, blocks: [], images: [], pixels, ...over });
const run = (format, m, title = "Rockets are cool", neighbours = { labs: [[50, 10, 10]], source: "library" }) =>
  Object.fromEntries(computeChecks({ format, title, measure: m, neighbours }).map((c) => [c.id, c]));

// A BGRA bitmap filled by `fill(x, y) -> [r, g, b]`.
function bitmap(w, h, fill) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) buf.set([...fill(x, y).reverse(), 255], (y * w + x) * 4);
  return buf;
}

test("checks come back in the planned order, each {id, level, value, message}", () => {
  const checks = computeChecks({ format: "video", title: "x", measure: measure(), neighbours: { labs: [], source: "decoys" } });
  assert.deepEqual(checks.map((c) => c.id), ["text.words", "text.repeatsTitle", "text.smallest", "text.contrast", "layout.badge", "subject.size", "image.contrast", "image.colourfulness", "feed.distinct"]);
  for (const c of checks) {
    assert.ok(["ok", "warn", "info"].includes(c.level));
    assert.ok("value" in c && typeof c.message === "string" && c.message.length < 260);
  }
  assert.equal(computeChecks({ format: "shorts", title: "x", measure: measure(), neighbours: null }).some((c) => c.id === "layout.safe"), true);
  assert.equal(computeChecks({ format: "podcast", title: "x", measure: measure(), neighbours: null }).some((c) => c.id.startsWith("layout.")), false);
});

test("text.words: five for 16:9 and 1:1, four for 9:16", () => {
  const five = [block(["one", "two", "three", "four", "five"], { x: 50, y: 50, w: 400, h: 100 })];
  assert.equal(run("video", measure({ blocks: five }))["text.words"].level, "ok");
  assert.equal(run("podcast", measure({ blocks: five }))["text.words"].level, "ok");
  assert.equal(run("shorts", measure({ blocks: five, canvas: { w: 720, h: 1280 } }))["text.words"].level, "warn");
  const six = [block(["a", "b", "c"], { x: 0, y: 0, w: 100, h: 50 }), block(["d", "e", "f"], { x: 0, y: 60, w: 100, h: 50 })];
  assert.equal(run("video", measure({ blocks: six }))["text.words"].level, "warn");
});

test("text.repeatsTitle ignores filler words and needs two content words", () => {
  const at = { x: 50, y: 50, w: 300, h: 80 };
  const same = run("video", measure({ blocks: [block(["rockets", "are", "cool"], at)] }));
  assert.equal(same["text.repeatsTitle"].level, "warn");
  assert.equal(same["text.repeatsTitle"].value, 1);
  assert.equal(run("video", measure({ blocks: [block(["rockets"], at)] }))["text.repeatsTitle"].level, "ok");
  assert.equal(run("video", measure({ blocks: [block(["launch", "day"], at)] }))["text.repeatsTitle"].level, "ok");
  assert.deepEqual(tokenize("Hello, WORLD! 2x..."), ["hello", "world", "2x"]);
});

test("text.smallest scales the cap height to the smallest surface and says what size is needed", () => {
  // 168/1280 * 70 = 9.2 px: fine. A 20 px font has a 14 px cap height, 1.8 px at 168 wide.
  assert.equal(run("video", measure({ blocks: [block(["big"], { x: 0, y: 0, w: 10, h: 10 })] }))["text.smallest"].level, "ok");
  const tiny = run("video", measure({ blocks: [block(["small", "print"], { x: 0, y: 0, w: 10, h: 10 }, { fontSize: 20, capHeight: 14 })] }))["text.smallest"];
  assert.equal(tiny.level, "warn");
  assert.equal(tiny.value, 1.8);
  assert.match(tiny.message, /at least 7\dpx/);
  assert.equal(run("video", measure())["text.smallest"].level, "info");
});

test("text.contrast measures against the backdrop and forgives outlined text a little", () => {
  const at = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(run("video", measure({ blocks: [block(["x"], at, { backdrop: 0.02 })] }))["text.contrast"].level, "ok");
  const weak = run("video", measure({ blocks: [block(["x"], at, { backdrop: 0.7, color: [255, 255, 255, 1] })] }))["text.contrast"];
  assert.equal(weak.level, "warn");
  assert.ok(weak.value < LIMITS.contrastFloor);
  // 2.6:1 passes only when the text is outlined or shadowed.
  const mid = { backdrop: 0.35, color: [255, 255, 255, 1] };
  assert.ok(contrastRatio(1, 0.35) > 2 && contrastRatio(1, 0.35) < 3);
  assert.equal(run("video", measure({ blocks: [block(["x"], at, mid)] }))["text.contrast"].level, "warn");
  assert.equal(run("video", measure({ blocks: [block(["x"], at, { ...mid, outlined: true })] }))["text.contrast"].level, "ok");
  // Text with no measurable colour (gradient text) is skipped, not failed.
  assert.equal(run("video", measure({ blocks: [block(["x"], at, { color: null })] }))["text.contrast"].level, "info");
});

test("layout.badge: text or a cut-out in the bottom-right zone", () => {
  const cutout = (rect) => ({ src: "assets/face-cutout.png", cutout: true, rect, opacity: 1 });
  assert.equal(run("video", measure({ blocks: [block(["x"], { x: 60, y: 60, w: 400, h: 100 })] }))["layout.badge"].level, "ok");
  assert.equal(run("video", measure({ blocks: [block(["late"], { x: 1150, y: 650, w: 100, h: 50 })] }))["layout.badge"].level, "warn");
  assert.equal(run("video", measure({ images: [cutout({ x: 800, y: 100, w: 480, h: 620 })] }))["layout.badge"].level, "warn");
  assert.equal(run("video", measure({ images: [cutout({ x: 800, y: 100, w: 300, h: 620 })] }))["layout.badge"].level, "ok");
});

test("layout.safe: the 3:4 crop and the overlay zones", () => {
  const m = (blocks, images = []) => measure({ canvas: { w: 720, h: 1280 }, blocks, images });
  const at = (x, y, w = 300, h = 100) => block(["hello"], { x, y, w, h });
  assert.equal(run("shorts", m([at(60, 400)]))["layout.safe"].level, "ok");
  assert.match(run("shorts", m([at(60, 20)]))["layout.safe"].message, /3:4/);
  assert.match(run("shorts", m([at(60, 1150)]))["layout.safe"].message, /3:4/);
  assert.match(run("shorts", m([at(500, 700, 200)]))["layout.safe"].message, /action buttons/);
  assert.match(run("shorts", m([at(60, 1030, 300, 60)]))["layout.safe"].message, /caption/);
  assert.equal(run("shorts", m([], [{ src: "a-cutout.png", cutout: true, rect: { x: 100, y: 40, w: 400, h: 900 }, opacity: 1 }]))["layout.safe"].level, "warn");
});

test("subject.size warns on a small cut-out and stays quiet without one", () => {
  const sized = (h) => measure({ images: [{ src: "p-cutout.png", cutout: true, rect: { x: 0, y: 0, w: 200, h }, opacity: 1 }] });
  assert.equal(run("video", sized(720 * 0.7))["subject.size"].level, "ok");
  const small = run("video", sized(720 * 0.3))["subject.size"];
  assert.equal(small.level, "warn");
  assert.equal(small.value, 0.3);
  assert.equal(run("video", measure({ images: [{ src: "bg.png", cutout: false, rect: { x: 0, y: 0, w: 1280, h: 720 }, opacity: 1 }] }))["subject.size"].level, "info");
});

test("image.contrast, image.colourfulness and feed.distinct are information, and say which side they are on", () => {
  const flat = run("video", measure({ pixels: { ...pixels, spread: 0.3, colourfulness: 5 } }));
  assert.equal(flat["image.contrast"].level, "info");
  assert.match(flat["image.contrast"].message, /Flat/);
  assert.match(flat["image.colourfulness"].message, /Muted/);
  const same = run("video", measure({ pixels: { ...pixels, meanLab: [50, 10, 10] } }), "t", { labs: [[52, 11, 9], [48, 9, 12]], source: "library" })["feed.distinct"];
  assert.equal(same.level, "info");
  assert.match(same.message, /Blends in/);
  const far = run("video", measure(), "t", { labs: [[90, -40, 40]], source: "decoys" })["feed.distinct"];
  assert.match(far.message, /Stands out/);
  assert.match(far.message, /stand-in/);
  assert.equal(run("video", measure(), "t", { labs: [], source: "decoys" })["feed.distinct"].value, null);
});

test("overlapShare is the share of the first rect inside the second", () => {
  assert.equal(overlapShare({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 }), 0.5);
  assert.equal(overlapShare({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }), 0);
});

test("pixel statistics: spread, colourfulness, backdrop and Lab", () => {
  const grey = pixelStats(bitmap(40, 40, () => [128, 128, 128]), 40, 40);
  assert.ok(grey.spread < 0.01 && grey.colourfulness < 0.01);
  const split = pixelStats(bitmap(40, 40, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255])), 40, 40);
  assert.ok(split.spread > 0.95);
  const red = pixelStats(bitmap(40, 40, (x) => (x < 20 ? [255, 0, 0] : [0, 0, 255])), 40, 40);
  assert.ok(red.colourfulness > 80);
  const bm = bitmap(100, 100, (x) => (x < 50 ? [0, 0, 0] : [255, 255, 255]));
  assert.ok(backdropLuminance(bm, 100, 100, { x: 0, y: 0, w: 40, h: 40 }) < 0.001);
  assert.ok(backdropLuminance(bm, 100, 100, { x: 60, y: 0, w: 30, h: 40 }) > 0.99);
  assert.equal(backdropLuminance(bm, 100, 100, { x: 500, y: 0, w: 5, h: 5 }), null);
  assert.ok(Math.abs(contrastRatio(relativeLuminance(255, 255, 255), relativeLuminance(0, 0, 0)) - 21) < 0.01);
  assert.ok(Math.abs(rgbToLab(255, 255, 255)[0] - 100) < 0.1);
  assert.ok(deltaE(rgbToLab(0, 0, 0), rgbToLab(255, 255, 255)) > 99);
});
