// Face retouching: the pixel maths on a synthetic face (each step moves its statistic the right way, size and
// alpha are kept exactly), then the pack around it: the queue, use_face's choice, settings and overrides, and
// the retouch-all endpoint. Never touches the owner's data or spends usage.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { ALL_STEPS, castOf, fallbackBox, highFrequencyEnergy, measureSkin, retouchFile, retouchPixels } from "../server/face-retouch.mjs";
import { faceImageFile, retouchOn, retouchStrengthFor, takeFace } from "../server/face-pack.mjs";
import { startApp, tempDir } from "./helpers.mjs";

const W = 400;
const H = 500;
const BOX = { x: 0.2, y: 0.15, w: 0.6, h: 0.55 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, ok, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`timed out; last: ${JSON.stringify(value).slice(0, 400)}`);
    await sleep(60);
  }
}

/** A seeded noise source so the "pores" are the same on every run. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/**
 * A synthetic cut-out: an elliptical subject on a transparent background, skin-coloured with pore noise, a dark
 * "brow" bar with hard edges inside the face box, a red blotch on the left cheek, and a black T-shirt below.
 */
function syntheticFace({ skin = [120, 78, 58], noise = 7, blotch = true } = {}) {
  const rgba = Buffer.alloc(W * H * 4);
  const rand = prng(7);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const inHead = ((x - 200) / 125) ** 2 + ((y - 215) / 160) ** 2 <= 1;
      const inShirt = y > 400 && x > 40 && x < 360;
      if (!inHead && !inShirt) continue;
      let c = inHead ? [...skin] : [14, 14, 16];
      if (inHead) {
        const n = rand() * 2 * noise;
        c = c.map((v) => v + n + rand() * noise * 0.5);
        if (y > 150 && y < 170 && x > 150 && x < 250) c = [28, 20, 18]; // brow bar: a hard edge
        if (blotch && (x - 130) ** 2 + (y - 270) ** 2 < 22 ** 2) c = [c[0] + 40, c[1] - 6, c[2] - 6]; // a red patch
      }
      rgba[i] = Math.max(0, Math.min(255, Math.round(c[0])));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
      rgba[i + 3] = 255;
    }
  }
  // Soft alpha around the rim, as a real cut-out has.
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = ((x - 200) / 125) ** 2 + ((y - 215) / 160) ** 2;
      if (d > 0.96 && d <= 1) rgba[(y * W + x) * 4 + 3] = Math.round(255 * (1 - (d - 0.96) / 0.04));
    }
  }
  return rgba;
}

const planesOf = (rgba) => {
  const n = W * H;
  const p = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    p[0][i] = rgba[i * 4] / 255;
    p[1][i] = rgba[i * 4 + 1] / 255;
    p[2][i] = rgba[i * 4 + 2] / 255;
    alpha[i] = rgba[i * 4 + 3];
  }
  return { planes: p, alpha };
};
const skinOf = (rgba) => measureSkin({ ...planesOf(rgba), width: W, height: H, box: BOX });
const lumaPlane = (rgba) => {
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) out[i] = 0.299 * (rgba[i * 4] / 255) + 0.587 * (rgba[i * 4 + 1] / 255) + 0.114 * (rgba[i * 4 + 2] / 255);
  return out;
};
const run = (rgba, opts = {}) => retouchPixels({ rgba, channels: 4, width: W, height: H, box: BOX, ...opts });
const energy = (rgba, region) => highFrequencyEnergy(lumaPlane(rgba), W, region);

test("the retouch keeps the size and the alpha exactly, and changes the colour", () => {
  const src = syntheticFace();
  const { data } = run(src, { strength: 0.7 });
  assert.equal(data.length, src.length);
  for (let i = 3; i < src.length; i += 4) if (data[i] !== src[i]) assert.fail(`alpha changed at pixel ${(i - 3) / 4}`);
  assert.notDeepEqual(data, src);
  // Strength 0 is a pass-through.
  assert.deepEqual(run(src, { strength: 0 }).data, src);
});

test("a dark image with a colour cast comes out brighter and more neutral", () => {
  const src = syntheticFace();
  const before = skinOf(src);
  const { data } = run(src, { strength: 0.8, steps: ["balance", "tone"] });
  const after = skinOf(data);
  assert.ok(before.luma < 0.4, `the input is dark (${before.luma.toFixed(2)})`);
  assert.ok(after.luma > before.luma + 0.05, `brighter: ${before.luma.toFixed(3)} -> ${after.luma.toFixed(3)}`);
  assert.ok(castOf(before) > 0.1, "the input has a cast");
  assert.ok(castOf(after) < castOf(before) * 0.6, `more neutral: cast ${castOf(before).toFixed(3)} -> ${castOf(after).toFixed(3)}`);
});

test("each step moves its own statistic the right way", () => {
  const src = syntheticFace({ skin: [200, 160, 140], noise: 3, blotch: false });
  const base = skinOf(src);

  // White balance alone: a skin tone that is too orange is pulled back, and the luma is held.
  const orange = syntheticFace({ skin: [190, 110, 80], noise: 3, blotch: false });
  const o = skinOf(orange);
  const balanced = skinOf(run(orange, { strength: 1, steps: ["balance"] }).data);
  assert.ok(balanced.rg < o.rg && castOf(balanced) < castOf(o), "less orange");
  assert.ok(Math.abs(balanced.luma - o.luma) < 0.02, "balance does not change the exposure");

  // Exposure: the dark face lifts, a bright one is left alone (or eased), and the black shirt stays black.
  const dark = syntheticFace({ skin: [110, 80, 70], noise: 3, blotch: false });
  const toned = run(dark, { strength: 1, steps: ["tone"] }).data;
  assert.ok(skinOf(toned).luma > skinOf(dark).luma + 0.08);
  const shirt = (rgba) => rgba[(450 * W + 200) * 4];
  assert.ok(Math.abs(shirt(toned) - shirt(dark)) <= 3, `black stays black (${shirt(dark)} -> ${shirt(toned)})`);
  assert.ok(Math.abs(skinOf(run(src, { strength: 1, steps: ["tone"] }).data).luma - base.luma) < 0.06, "a healthy face is barely moved");

  // Warmth and vibrance: a touch warmer and more saturated, never orange.
  const warm = skinOf(run(src, { strength: 1, steps: ["warmth"] }).data);
  assert.ok(warm.rg > base.rg, "warmer");
  assert.ok(warm.rg < 1.45, `never orange (R/G ${warm.rg.toFixed(2)})`);

  // Redness: the red blotch loses its excess red; plain skin does not.
  const blotchy = syntheticFace({ skin: [200, 160, 140], noise: 3, blotch: true });
  const redExcess = (rgba, x, y) => rgba[(y * W + x) * 4] - (rgba[(y * W + x) * 4 + 1] + rgba[(y * W + x) * 4 + 2]) / 2;
  const calmed = run(blotchy, { strength: 1, steps: ["redness"] }).data;
  assert.ok(redExcess(calmed, 130, 270) < redExcess(blotchy, 130, 270) - 8, "blotch calmed");
  assert.ok(Math.abs(redExcess(calmed, 260, 330) - redExcess(blotchy, 260, 330)) < 6, `plain skin untouched ${redExcess(blotchy, 260, 330)} -> ${redExcess(calmed, 260, 330)}`);

  // Sharpening: the hard edge of the brow gets crisper.
  const edge = { x0: 140, y0: 140, x1: 260, y1: 180 };
  assert.ok(energy(run(src, { strength: 1, steps: ["sharpen"] }).data, edge) > energy(src, edge), "more edge energy");
});

test("smoothing lowers the high-frequency energy of skin and keeps the edges", () => {
  const src = syntheticFace({ skin: [200, 160, 140], noise: 9, blotch: false });
  const skinPatch = { x0: 215, y0: 280, x1: 290, y1: 340 };
  const edgePatch = { x0: 140, y0: 148, x1: 260, y1: 172 }; // the brow bar
  const { data } = run(src, { strength: 1, steps: ["smooth"] });
  const flat = energy(data, skinPatch) / energy(src, skinPatch);
  const edges = energy(data, edgePatch) / energy(src, edgePatch);
  assert.ok(flat < 0.65, `skin texture falls (to ${(flat * 100).toFixed(0)}%)`);
  assert.ok(edges > 0.8, `edges keep their energy (${(edges * 100).toFixed(0)}%)`);
  // The black shirt, outside the box, is not smoothed at all.
  const shirtPatch = { x0: 60, y0: 410, x1: 340, y1: 490 };
  assert.equal(energy(data, shirtPatch), energy(src, shirtPatch));
});

test("a photo with no face box yet gets a guess from the cut-out", () => {
  const alpha = new Uint8Array(W * H);
  const face = syntheticFace();
  for (let i = 0; i < W * H; i += 1) alpha[i] = face[i * 4 + 3];
  const box = fallbackBox(alpha, W, H);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1 && box.y + box.h <= 1 && box.w > 0.1 && box.h > 0.1);
  const { report } = retouchPixels({ rgba: syntheticFace(), channels: 4, width: W, height: H, strength: 0.5 });
  assert.deepEqual(report.steps.map((s) => s.step), ALL_STEPS);
});

test("retouchFile writes a PNG of the cut-out's size with its alpha", async () => {
  const dir = tempDir();
  const src = syntheticFace();
  await sharp(src, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(dir, "cutout.png"));
  const out = await retouchFile({ cutout: path.join(dir, "cutout.png"), destination: path.join(dir, "retouched.png"), box: BOX, strength: 0.5 });
  assert.equal(out.width, W);
  const back = await sharp(path.join(dir, "retouched.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(back.info.width, W);
  assert.equal(back.info.height, H);
  for (let i = 3; i < src.length; i += 4) if (back.data[i] !== src[i]) assert.fail("alpha changed");
});

// ---- the pack ------------------------------------------------------------------------------------

/** The upload stand-in for the cut-out: the photo as a PNG with its alpha. */
const fakeCutOutFile = async (source, destination) => {
  const out = await sharp(source).ensureAlpha().png().toBuffer({ resolveWithObject: true });
  fs.writeFileSync(destination, out.data);
  return { width: out.info.width, height: out.info.height };
};

async function skinPhoto() {
  return sharp(syntheticFace({ skin: [150, 105, 85] }), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

async function setup(overrides = {}) {
  const t = await startApp({ facesBatchMs: 30, ...overrides }, { cutOutFile: fakeCutOutFile });
  const upload = async (name, bytes) => {
    const res = await fetch(`${t.base}/api/faces`, { method: "POST", headers: { "x-filename": encodeURIComponent(name), "content-type": "image/png" }, body: bytes });
    return { status: res.status, body: await res.json() };
  };
  const list = async () => (await t.api("GET", "/api/faces")).body;
  const done = (l) => l.items.length > 0 && l.items.every((f) => f.stage === "ready" && f.retouch.state === "done");
  return { t, upload, list, done };
}

test("new uploads are retouched in the queue after the cut-out, again once the real face box is known, and served", async () => {
  const { t, upload, list, done } = await setup();
  try {
    await upload("me.png", await skinPhoto());
    const [face] = (await until(list, done)).items;
    assert.equal(face.retouch.enabled, true);
    assert.equal(face.retouch.appliedStrength, 0.5);
    assert.match(face.retouch.url, /^\/faces\/[a-f0-9]{8}\/retouched\.png\?v=\d+$/);
    const dir = path.join(t.dataDir, "faces", face.id);
    const json = JSON.parse(fs.readFileSync(path.join(dir, "face.json"), "utf8"));
    assert.equal(json.retouched.box, "labels", "re-run with the classifier's face box");
    // Same geometry as the cut-out, different pixels.
    const cut = await sharp(path.join(dir, "cutout.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ret = await sharp(path.join(dir, "retouched.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([ret.info.width, ret.info.height], [cut.info.width, cut.info.height]);
    assert.ok(!ret.data.equals(cut.data));
    for (let i = 3; i < cut.data.length; i += 4) if (ret.data[i] !== cut.data[i]) assert.fail("alpha changed");
    // The quality grade was computed from the original, not from the retouch.
    assert.ok(face.quality);
    // Files are served like the others.
    for (const file of ["retouched.png", "retouched-thumb.png"]) {
      const res = await fetch(`${t.base}/faces/${face.id}/${file}`);
      assert.equal(res.status, 200, file);
      assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    }
  } finally {
    await t.close();
  }
});

test("with Retouch faces off, uploads are not retouched; a per-face choice and strength override the pack", async () => {
  const { t, upload, list } = await setup();
  try {
    assert.deepEqual((await t.api("PUT", "/api/faces/settings", { retouchAll: false })).body, { mirrorAll: true, retouchAll: false, retouchStrength: 0.5 });
    await upload("me.png", await skinPhoto());
    const ready = (l) => l.items.length > 0 && l.items.every((f) => f.stage === "ready");
    const [face] = (await until(list, ready)).items;
    await sleep(200);
    assert.equal(face.retouch.enabled, false);
    assert.equal(face.retouch.state, "none");
    assert.equal(fs.existsSync(path.join(t.dataDir, "faces", face.id, "retouched.png")), false);

    // The owner turns it on for this face, at its own strength.
    const on = (await t.api("PATCH", `/api/faces/${face.id}`, { retouch: true, retouchStrength: 0.8 })).body;
    assert.equal(on.retouch.enabled, true);
    assert.equal(on.retouch.override, true);
    assert.equal(on.retouch.strength, 0.8);
    const retouched = (await until(list, (l) => l.items[0].retouch.state === "done")).items[0];
    assert.equal(retouched.retouch.appliedStrength, 0.8);

    // Back to the pack's choice (off), and the strength follows the pack again.
    const back = (await t.api("PATCH", `/api/faces/${face.id}`, { retouch: null, retouchStrength: null })).body;
    assert.equal(back.retouch.enabled, false);
    assert.equal(back.retouch.override, null);
    assert.equal(back.retouch.strength, 0.5);
    for (const bad of [{ retouch: "yes" }, { retouchStrength: 2 }, { retouchStrength: "x" }]) assert.equal((await t.api("PATCH", `/api/faces/${face.id}`, bad)).status, 400, JSON.stringify(bad));
    assert.equal((await t.api("PUT", "/api/faces/settings", { retouchStrength: 1.5 })).status, 400);
    assert.equal((await t.api("PUT", "/api/faces/settings", { retouchAll: "on" })).status, 400);
    assert.equal((await t.api("PUT", "/api/faces/settings", {})).status, 400);
    assert.equal((await t.api("PUT", "/api/faces/settings", { retouchStrength: 0.3 })).body.retouchStrength, 0.3);
    assert.equal((await list()).settings.retouchStrength, 0.3);
  } finally {
    await t.close();
  }
});

test("POST /api/faces/retouch retouches all existing faces, or the ones named, skipping a face switched off", async () => {
  const { t, upload, list, done } = await setup();
  try {
    for (const name of ["a.png", "b.png", "c.png"]) await upload(name, await skinPhoto());
    const first = await until(list, (l) => l.items.length === 3 && done(l));
    const [a, b, c] = first.items;
    assert.equal((await t.api("PATCH", `/api/faces/${c.id}`, { retouch: false })).body.retouch.enabled, false);

    // A new strength for the pack, then Retouch all: every enabled face is redone at it.
    await t.api("PUT", "/api/faces/settings", { retouchStrength: 0.9 });
    const res = await t.api("POST", "/api/faces/retouch", {});
    assert.equal(res.status, 202);
    assert.deepEqual([...res.body.changed].sort(), [a.id, b.id].sort());
    assert.deepEqual(res.body.skipped, [c.id]);
    const after = await until(list, (l) => l.items.filter((f) => f.retouch.appliedStrength === 0.9).length === 2 && l.items.every((f) => ["done", "none"].includes(f.retouch.state)));
    assert.equal(after.items.find((f) => f.id === c.id).retouch.appliedStrength, 0.5, "the switched-off face keeps what it had");

    // By id, and a bad id list is refused.
    const one = await t.api("POST", "/api/faces/retouch", { ids: [a.id] });
    assert.deepEqual(one.body.changed, [a.id]);
    await until(list, (l) => l.items.every((f) => f.retouch.state === "done"));
    assert.equal((await t.api("POST", "/api/faces/retouch", { ids: ["../x"] })).status, 400);
    assert.equal((await t.api("POST", "/api/faces/retouch", { ids: "all" })).status, 400);
  } finally {
    await t.close();
  }
});

test("use_face takes retouched.png when the effective retouch is on and done, otherwise the cut-out; mirroring works on either", async () => {
  const dataDir = tempDir();
  const projectDir = tempDir();
  const dir = path.join(dataDir, "faces", "aaaaaaaa");
  fs.mkdirSync(dir, { recursive: true });
  // Cut-out: left half red, right half blue. Retouched: left half green, right half yellow.
  const split = async (l, r) => {
    const raw = Buffer.alloc(8 * 2 * 3);
    for (let y = 0; y < 2; y += 1) for (let x = 0; x < 8; x += 1) raw.set(x < 4 ? l : r, (y * 8 + x) * 3);
    return sharp(raw, { raw: { width: 8, height: 2, channels: 3 } }).png().toBuffer();
  };
  fs.writeFileSync(path.join(dir, "cutout.png"), await split([255, 0, 0], [0, 0, 255]));
  fs.writeFileSync(path.join(dir, "retouched.png"), await split([0, 255, 0], [255, 255, 0]));
  const face = {
    schemaVersion: 1, id: "aaaaaaaa", addedAt: "2026-10-01T10:00:00.000Z", filename: "me.png",
    original: { file: "original.png", width: 8, height: 2, bytes: 1 },
    cutout: { state: "done", width: 8, height: 2, thumb: false },
    classification: { state: "done", reason: "" },
    labels: { expression: "smile", intensity: 2, gesture: "none", gaze: "camera", eyesOpen: true, headTurn: "frontal", faceBox: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, textOrLogoInShot: false, description: "x" },
    labelsEditedByOwner: false, mirrorAllowed: null, quality: { grade: "hd", faceHeightPx: 600, sharpness: 100 }, starred: false, hidden: false,
    retouched: { state: "done", strength: 0.5, box: "labels", thumb: false },
  };
  const write = (over) => fs.writeFileSync(path.join(dir, "face.json"), JSON.stringify({ ...face, ...over }));
  const px = async (name, x) => [...(await sharp(path.join(projectDir, "assets", name)).raw().toBuffer()).subarray(x * 3, x * 3 + 3)];

  write({});
  const on = await takeFace(dataDir, projectDir, "aaaaaaaa");
  assert.equal(on.retouched, true);
  assert.deepEqual(await px(on.name, 0), [0, 255, 0], "the default is on: the retouched image");
  const flipped = await takeFace(dataDir, projectDir, "aaaaaaaa", { mirror: true });
  assert.deepEqual(await px(flipped.name, 0), [255, 255, 0], "mirrored retouched image");

  write({ retouch: false });
  const off = await takeFace(dataDir, projectDir, "aaaaaaaa");
  assert.equal(off.retouched, false);
  assert.deepEqual(await px(off.name, 0), [255, 0, 0], "the owner switched it off for this face: the cut-out");
  assert.deepEqual(await px((await takeFace(dataDir, projectDir, "aaaaaaaa", { mirror: true })).name, 0), [0, 0, 255], "mirrored cut-out");

  // The pack setting decides when the face has no choice of its own, and a retouch not done yet falls back to the cut-out.
  fs.writeFileSync(path.join(dataDir, "faces", "settings.json"), JSON.stringify({ retouchAll: false }));
  write({ retouch: null });
  assert.deepEqual(await px((await takeFace(dataDir, projectDir, "aaaaaaaa")).name, 0), [255, 0, 0]);
  write({ retouch: true });
  assert.deepEqual(await px((await takeFace(dataDir, projectDir, "aaaaaaaa")).name, 0), [0, 255, 0]);
  write({ retouch: true, retouched: { state: "running" } });
  assert.deepEqual(await px((await takeFace(dataDir, projectDir, "aaaaaaaa")).name, 0), [255, 0, 0], "not done yet");

  assert.equal(retouchOn({ retouch: null }, { retouchAll: true }), true);
  assert.equal(retouchOn({ retouch: false }, { retouchAll: true }), false);
  assert.equal(retouchStrengthFor({ retouchStrength: 0.2 }, { retouchStrength: 0.7 }), 0.2);
  assert.equal(retouchStrengthFor({}, { retouchStrength: 0.7 }), 0.7);
  assert.equal(faceImageFile({ retouched: { state: "done" } }, { retouchAll: true }), "retouched.png");
});

/** The synthetic face with an open smile: a row of yellowish teeth between red lips in the lower face, about a third of
 * the face box wide, as a real smile's teeth are. */
function smilingFace({ open = true } = {}) {
  const rgba = syntheticFace({ blotch: false });
  const lip = [150, 70, 62];
  const tooth = [222, 196, 150];
  for (let y = 300; y < 336; y += 1) {
    for (let x = 160; x < 240; x += 1) {
      const i = (y * W + x) * 4;
      const inLip = y < 306 || y >= 330;
      const c = !open || inLip ? lip : (x - 160) % 16 === 0 ? [120, 80, 70] : tooth; // a dark line between teeth
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
    }
  }
  return rgba;
}
const yellowness = (rgba, x0, x1, y0, y1) => {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { const i = (y * W + x) * 4; s += (rgba[i] + rgba[i + 1]) / 2 - rgba[i + 2]; n += 1; }
  return s / n;
};

test("teeth are found in an open smile and lose their yellow; lips and a closed mouth are left alone", () => {
  const src = smilingFace();
  const { data, report } = run(src, { strength: 0.75, steps: ["teeth"] });
  assert.ok(report.steps[0].found > 400, `teeth found: ${report.steps[0].found}`);
  // Every tooth along the row, not just the brightest one, loses most of its yellow.
  for (const x0 of [163, 180, 212, 228]) assert.ok(yellowness(data, x0, x0 + 10, 310, 326) < yellowness(src, x0, x0 + 10, 310, 326) * 0.75, `tooth at x ${x0}`);
  // The lips keep their colour.
  assert.ok(Math.abs(yellowness(data, 165, 235, 300, 304) - yellowness(src, 165, 235, 300, 304)) < 4, "upper lip");
  // Nothing is whitened past an off-white.
  for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > 231 && Math.max(src[i], src[i + 1], src[i + 2]) <= 231) assert.fail("whitened past the cap");
  const closed = smilingFace({ open: false });
  assert.equal(run(closed, { strength: 0.75, steps: ["teeth"] }).report.steps[0].found, 0);
});

test("a cut-out's interior is made solid, its soft edge is left as the model gave it", async () => {
  const { solidInterior } = await import("../server/cutout.mjs");
  const w = 60;
  const h = 60;
  const alpha = Buffer.alloc(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.hypot(x - 30, y - 30);
      alpha[y * w + x] = d < 20 ? 255 : d < 24 ? Math.round(255 * (24 - d) / 4) : 0; // a disc with a soft rim
    }
  }
  for (let y = 26; y < 34; y += 1) for (let x = 26; x < 34; x += 1) alpha[y * w + x] = 246; // "teeth" a little see-through
  for (let y = 14; y < 20; y += 1) for (let x = 14; x < 20; x += 1) alpha[y * w + x] = 0; // background enclosed by the subject
  const out = solidInterior(alpha, w, h);
  assert.equal(out[30 * w + 30], 255, "interior made solid");
  assert.equal(out[16 * w + 16], 0, "enclosed background stays transparent");
  for (let i = 0; i < w * h; i += 1) {
    const d = Math.hypot((i % w) - 30, Math.floor(i / w) - 30);
    if (d >= 19 || alpha[i] < 200) assert.equal(out[i], alpha[i], `pixel ${i} untouched`);
  }
});

test("blemish healing evens out a red patch on the cheek and keeps the skin's texture", () => {
  const src = syntheticFace();
  const { data, report } = run(src, { strength: 0.8, steps: ["blemish"] });
  assert.ok(report.steps[0].healed > 0);
  const red = (rgba, x0, y0, r) => {
    let s = 0;
    let n = 0;
    for (let y = y0 - r; y < y0 + r; y += 1) for (let x = x0 - r; x < x0 + r; x += 1) { const i = (y * W + x) * 4; s += rgba[i] - (rgba[i + 1] + rgba[i + 2]) / 2; n += 1; }
    return s / n;
  };
  const around = red(src, 200, 300, 10);
  assert.ok(red(data, 130, 270, 12) - around < (red(src, 130, 270, 12) - around) * 0.6, "the patch is much closer to the skin around it");
  assert.ok(energy(data, { x0: 110, y0: 250, x1: 150, y1: 290 }) > energy(src, { x0: 110, y0: 250, x1: 150, y1: 290 }) * 0.4, "pores survive");
});
