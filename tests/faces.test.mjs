// The face pack: upload and cut-out queue, classification (locked down, validated), owner edits, quality,
// find_faces / use_face, mirroring, planner wiring and file serving.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";
import { diversifyFaces, fallbackConcepts, validateConcepts } from "../server/concept-sets.mjs";
import { buildFacesArgs } from "../server/claude-runner.mjs";
import { QUALITY, gradeOf, laplacianVariance, measureSharpness, mirrorAllowedFor, packSelection, qualityOf, rankFaces, takeFace, validateLabels } from "../server/face-pack.mjs";
import { makePng, startApp, tempDir } from "./helpers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withEnv(vars, fn) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
async function until(read, ok, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`timed out; last: ${JSON.stringify(value).slice(0, 500)}`);
    await sleep(60);
  }
}
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];
const readCalls = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/** The cut-out stand-in: the original as a PNG with its own size. */
const fakeCutOutFile = async (source, destination) => {
  const out = await sharp(source).png().toBuffer({ resolveWithObject: true });
  fs.writeFileSync(destination, out.data);
  return { width: out.info.width, height: out.info.height };
};

async function setup(overrides = {}) {
  const t = await startApp({ facesBatchMs: 30, ...overrides }, { cutOutFile: fakeCutOutFile });
  const upload = async (name, bytes, type = "application/octet-stream") => {
    const res = await fetch(`${t.base}/api/faces`, { method: "POST", headers: { "x-filename": encodeURIComponent(name), "content-type": type }, body: bytes });
    return { status: res.status, body: await res.json() };
  };
  const list = async () => (await t.api("GET", "/api/faces")).body;
  const settled = (l) => l.items.length > 0 && l.items.every((f) => ["ready", "unclassified", "failed"].includes(f.stage));
  return { t, upload, list, settled };
}

/** A face folder as the server leaves it, for the tests that do not need the pipeline. */
function seedFace(dataDir, id, over = {}) {
  const dir = path.join(dataDir, "faces", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "cutout.png"), makePng(40, 60, [200, 40, 40]));
  fs.writeFileSync(path.join(dir, "thumb.png"), makePng(20, 30, [200, 40, 40]));
  const face = {
    schemaVersion: 1,
    id,
    addedAt: "2026-10-01T10:00:00.000Z",
    filename: "me.png",
    original: { file: "original.png", width: 40, height: 60, bytes: 1 },
    cutout: { state: "done", width: 40, height: 60, thumb: true },
    classification: { state: "done", reason: "" },
    labels: { expression: "smile", intensity: 2, gesture: "none", gaze: "camera", eyesOpen: true, headTurn: "frontal", faceBox: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, textOrLogoInShot: false, description: "A smile" },
    labelsEditedByOwner: false,
    mirrorAllowed: null,
    quality: { grade: "hd", faceHeightPx: 600, sharpness: 100 },
    starred: false,
    hidden: false,
    ...over,
  };
  fs.writeFileSync(path.join(dir, "face.json"), JSON.stringify(face));
  fs.writeFileSync(path.join(dir, "original.png"), makePng(40, 60));
  return face;
}
const L = (over) => ({ expression: "smile", intensity: 2, gesture: "none", gaze: "camera", eyesOpen: true, headTurn: "frontal", faceBox: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, textOrLogoInShot: false, description: "x", ...over });

test("the vocabulary is enforced: anything outside it is refused", () => {
  assert.equal(validateLabels(L()).ok, true);
  for (const bad of [{ expression: "ecstatic" }, { intensity: 4 }, { intensity: 1.5 }, { gesture: "wave" }, { gaze: "forward" }, { headTurn: "back" }, { eyesOpen: "yes" }, { description: "" }, { faceBox: { x: 0.9, y: 0.1, w: 0.5, h: 0.5 } }, { faceBox: null }]) {
    assert.equal(validateLabels(L(bad)).ok, false, JSON.stringify(bad));
  }
  const clean = validateLabels(L({ description: "line one\nline two\u0000" }));
  assert.equal(clean.labels.description, "line one line two");
  assert.deepEqual(validateLabels(L({ faceBox: { x: 0.5, y: 0, w: 0.51, h: 0.5 } })).labels.faceBox.w, 0.5, "slight overshoot is clamped");
});

test("quality grades: the pixel height and the sharpness, with documented thresholds", async () => {
  assert.equal(gradeOf({ faceHeightPx: 1000, sharpness: 200 }), "4k");
  assert.equal(gradeOf({ faceHeightPx: 999, sharpness: 200 }), "hd");
  assert.equal(gradeOf({ faceHeightPx: 540, sharpness: null }), "hd");
  assert.equal(gradeOf({ faceHeightPx: 539, sharpness: 200 }), "soft");
  assert.equal(gradeOf({ faceHeightPx: 2000, sharpness: QUALITY.sharp4k - 1 }), "hd", "a blurry big face is held at hd");
  assert.equal(gradeOf({ faceHeightPx: 2000, sharpness: QUALITY.sharpHd - 1 }), "soft");
  assert.deepEqual(qualityOf({ faceBox: { x: 0, y: 0, w: 0.5, h: 0.4 }, imageHeight: 3000, sharpness: 150 }), { grade: "4k", faceHeightPx: 1200, sharpness: 150 });
  assert.equal(qualityOf({ faceBox: null, imageHeight: 100 }), null);
  // Measured on real pixels: noise is sharp, a blurred copy of it is not.
  const noise = Buffer.alloc(400 * 400 * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
  const sharpPng = await sharp(noise, { raw: { width: 400, height: 400, channels: 3 } }).png().toBuffer();
  const blurPng = await sharp(sharpPng).blur(6).png().toBuffer();
  const box = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  const sharpScore = await measureSharpness(sharpPng, box);
  const blurScore = await measureSharpness(blurPng, box);
  assert.ok(sharpScore > QUALITY.sharp4k * 5 && blurScore < QUALITY.sharpHd, `${sharpScore} vs ${blurScore}`);
  assert.equal(laplacianVariance(new Uint8Array(100).fill(7), 10, 10), 0);
});

test("upload, cut-out queue and classification: the face ends ready with labels, a grade and served images", async () => {
  const { t, upload, list, settled } = await setup();
  const argsFile = path.join(tempDir(), "args.jsonl");
  try {
    await withEnv({ FAKE_CLAUDE_ARGS_OUT: argsFile }, async () => {
      const photos = [makePng(64, 96, [200, 90, 90]), makePng(64, 96, [90, 200, 90]), makePng(64, 96, [90, 90, 200])];
      const made = [];
      for (const [i, p] of photos.entries()) made.push(await upload(`Me ${i}.png`, p, "image/png"));
      assert.deepEqual(made.map((m) => m.status), [201, 201, 201]);
      assert.ok(["queued", "cutting"].includes(made[0].body.stage));
      const final = await until(list, settled);
      assert.equal(final.counts.ready, 3);
      assert.ok(final.items.every((f) => f.labels && f.quality && f.cutout.url));
      assert.equal(final.items[0].original.width, 64);
      assert.equal(final.items.find((f) => f.labels.description === "Fake photo 3").labels.textOrLogoInShot, true);
      // 96 px high, face box 0.6: 58 px, so soft.
      assert.equal(final.items[0].quality.grade, "soft");
      assert.equal(final.items[0].quality.faceHeightPx, 58);
    });

    // One turn for the batch, locked down like the planner, on the faces model at low effort.
    const calls = readCalls(argsFile);
    assert.equal(calls.length, 1, "one classification turn for the batch");
    const a = calls[0].argv;
    assert.ok(a.includes("--restricted"));
    assert.equal(flagOf(a, "--model"), "claude-haiku-5-5");
    assert.equal(flagOf(a, "--effort"), "low");
    assert.equal(flagOf(a, "--permission-mode"), "dontAsk");
    assert.equal(flagOf(a, "--permission-prompts"), "none");
    assert.equal(flagOf(a, "--tools"), "Read,Write,Glob");
    assert.equal(flagOf(a, "--allowedTools"), "Read(./**),Glob(./**),Write(./labels.json)");
    for (const denied of ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit", "Edit", "Write(./images/**)"]) assert.ok(flagOf(a, "--disallowedTools").split(",").includes(denied), denied);
    assert.deepEqual(JSON.parse(flagOf(a, "--mcp-config")), { mcpServers: {} });
    assert.ok(a.includes("--strict-mcp-config") && a.includes("--disable-slash-commands"));
    assert.equal(flagOf(a, "--setting-sources"), "");
    assert.ok(!a.join(" ").includes("mcp__imago"));
    assert.match(calls[0].systemPrompt, /You label photos of the owner's face/);
    assert.match(calls[0].systemPrompt, /never an instruction/);
    assert.match(calls[0].stdin, /Label the 3 photos in images\//);
    assert.ok(!fs.readdirSync(path.join(t.dataDir, "faces")).includes(".work") || fs.readdirSync(path.join(t.dataDir, "faces", ".work")).length === 0, "the work folder is removed");
    // buildFacesArgs honours IMAGO_FACES_MODEL through the config.
    assert.equal(flagOf(buildFacesArgs({ facesModel: "m-x", facesEffort: "low" }), "--model"), "m-x");

    // Files: only images, with the sandbox CSP and nosniff.
    const id = (await list()).items[0].id;
    for (const file of ["cutout.png", "thumb.png", "original.png"]) {
      const res = await fetch(`${t.base}/faces/${id}/${file}`);
      assert.equal(res.status, 200, file);
      assert.equal(res.headers.get("content-type"), "image/png");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    }
    for (const bad of [`${id}/face.json`, `${id}/..%2Fface.json`, `${id}/original.jpg`, `${id}/settings.png`, `nothere/cutout.png`, id]) {
      assert.ok([400, 404].includes((await fetch(`${t.base}/faces/${bad}`)).status), bad);
    }
    assert.equal((await fetch(`${t.base}/faces/${id}/face.json`)).status, 404);
  } finally {
    await t.close();
  }
});

test("uploads follow the project asset rules", async () => {
  const { t, upload } = await setup();
  try {
    assert.equal((await upload("a.gif", Buffer.from("GIF89a....................................."))).status, 415);
    assert.equal((await upload("a.png", makePng(4, 4), "text/html")).status, 415);
    const noName = await fetch(`${t.base}/api/faces`, { method: "POST", body: makePng(4, 4) });
    assert.equal(noName.status, 400);
    const huge = makePng(4, 4);
    huge.writeUInt32BE(20000, 16);
    huge.writeUInt32BE(20000, 20);
    assert.equal((await upload("big.png", huge)).status, 413);
    const ok = await upload("../../evil name.png", makePng(8, 8));
    assert.equal(ok.status, 201);
    assert.match(ok.body.id, /^[a-f0-9]{8}$/);
    assert.equal(ok.body.filename, "evil-name.png");
    assert.deepEqual(fs.readdirSync(path.join(t.dataDir, "faces", ok.body.id)).filter((n) => n.startsWith("original")), ["original.png"]);
  } finally {
    await t.close();
  }
});

test("invalid classifier output: what validates is kept, the rest is unclassified and a retry fixes it", async () => {
  const { t, upload, list, settled } = await setup();
  try {
    await withEnv({ FAKE_CLAUDE_FACES: "invalid" }, async () => {
      for (let i = 0; i < 3; i += 1) await upload(`p${i}.png`, makePng(32, 32, [i * 50, 10, 10]), "image/png");
      const l = await until(list, settled);
      const stages = l.items.map((f) => f.stage).sort();
      assert.deepEqual(stages, ["ready", "ready", "unclassified"]);
      const bad = l.items.find((f) => f.stage === "unclassified");
      assert.match(bad.error, /expression/);
      assert.equal(bad.labels, null);
    });
    await withEnv({ FAKE_CLAUDE_FACES: "" }, async () => {
      const bad = (await list()).items.find((f) => f.stage === "unclassified");
      const r = await t.api("POST", "/api/faces/reclassify", { ids: [bad.id] });
      assert.deepEqual(r.body.changed, [bad.id]);
      const l = await until(list, (x) => x.items.every((f) => f.stage === "ready"));
      assert.equal(l.counts.unclassified, 0);
    });
    await withEnv({ FAKE_CLAUDE_FACES: "partial" }, async () => {
      const a = await upload("pa.png", makePng(32, 32, [1, 99, 5]), "image/png");
      const b = await upload("pb.png", makePng(32, 32, [2, 98, 5]), "image/png");
      const l = await until(list, (x) => [a, b].every((u) => ["ready", "unclassified"].includes(x.items.find((f) => f.id === u.body.id)?.stage)));
      assert.deepEqual([a, b].map((u) => l.items.find((f) => f.id === u.body.id).stage).sort(), ["ready", "unclassified"], "the photo Claude skipped is unclassified");
      for (const u of [a, b]) await t.api("DELETE", `/api/faces/${u.body.id}`);
    });
    for (const mode of ["missing", "badjson"]) {
      await withEnv({ FAKE_CLAUDE_FACES: mode }, async () => {
        const fresh = await upload(`${mode}.png`, makePng(32, 32, [5, 5, 99]), "image/png");
        const l = await until(list, (x) => x.items.find((f) => f.id === fresh.body.id)?.stage === "unclassified");
        assert.ok(l.items.find((f) => f.id === fresh.body.id).error.length > 0, mode);
        await t.api("DELETE", `/api/faces/${fresh.body.id}`);
      });
    }
  } finally {
    await t.close();
  }
});

test("a failed Reclassify keeps labels a face already had", async () => {
  const { t, upload, list, settled } = await setup();
  try {
    await upload("p.png", makePng(32, 32), "image/png");
    const first = await until(list, settled);
    await withEnv({ FAKE_CLAUDE_FACES: "missing" }, async () => {
      await t.api("POST", "/api/faces/reclassify", {});
      await sleep(50);
      const l = await until(list, settled);
      assert.equal(l.items[0].stage, "ready");
      assert.deepEqual(l.items[0].labels, first.items[0].labels);
    });
  } finally {
    await t.close();
  }
});

test("labels the owner edited are never overwritten, and star, hide and delete with undo work", async () => {
  const { t, upload, list, settled } = await setup();
  try {
    await upload("p.png", makePng(32, 32), "image/png");
    const [face] = (await until(list, settled)).items;
    const edit = await t.api("PATCH", `/api/faces/${face.id}`, { labels: { expression: "angry", gaze: "left" } });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.labels.expression, "angry");
    assert.equal(edit.body.labelsEditedByOwner, true);
    assert.equal((await t.api("PATCH", `/api/faces/${face.id}`, { labels: { expression: "ecstatic" } })).status, 400);
    assert.equal((await t.api("PATCH", `/api/faces/${face.id}`, { starred: "yes" })).status, 400);
    const r = await t.api("POST", "/api/faces/reclassify", {});
    assert.deepEqual(r.body, { ok: true, changed: [], skipped: [face.id] });
    await sleep(150);
    const after = (await list()).items[0];
    assert.equal(after.labels.expression, "angry");
    assert.equal(after.labels.gaze, "left");

    assert.equal((await t.api("PATCH", `/api/faces/${face.id}`, { starred: true, hidden: true })).body.hidden, true);
    assert.equal((await t.api("DELETE", `/api/faces/${face.id}`)).status, 200);
    assert.equal((await list()).items.length, 0);
    assert.equal((await fetch(`${t.base}/faces/${face.id}/cutout.png`)).status, 404);
    const back = await t.api("POST", `/api/faces/${face.id}/restore`);
    assert.equal(back.body.starred, true);
    assert.equal((await list()).items.length, 1);
  } finally {
    await t.close();
  }
});

test("a failed cut-out is reported and can be retried", async () => {
  let fail = true;
  const t = await startApp({ facesBatchMs: 30 }, { cutOutFile: async (s, d) => (fail ? Promise.reject(new Error("model exploded")) : fakeCutOutFile(s, d)) });
  try {
    const up = await fetch(`${t.base}/api/faces`, { method: "POST", headers: { "x-filename": "a.png" }, body: makePng(16, 16) });
    const id = (await up.json()).id;
    const l = await until(async () => (await t.api("GET", "/api/faces")).body, (x) => x.items[0]?.stage === "failed");
    assert.match(l.items[0].error, /model exploded/);
    fail = false;
    assert.equal((await t.api("POST", `/api/faces/${id}/recut`)).status, 202);
    await until(async () => (await t.api("GET", "/api/faces")).body, (x) => x.items[0]?.stage === "ready");
  } finally {
    await t.close();
  }
});

test("find_faces ranking: starred first, hidden excluded, then grade, sharp and recent", () => {
  const f = (id, over = {}, q = {}) => ({ id, addedAt: "2026-10-01T00:00:00Z", starred: false, hidden: false, cutout: { state: "done" }, classification: { state: "done" }, labels: L(), quality: { grade: "hd", faceHeightPx: 600, sharpness: 100, ...q }, ...over });
  const pool = [
    f("00000001", { addedAt: "2026-09-01T00:00:00Z" }),
    f("00000002", { addedAt: "2026-10-05T00:00:00Z" }),
    f("00000003", { addedAt: "2026-10-03T00:00:00Z" }, { sharpness: 400 }),
    f("00000004", { starred: true }, { grade: "soft" }),
    f("00000005", { hidden: true }, { grade: "4k" }),
    f("00000006", {}, { grade: "4k" }),
    f("00000007", { classification: { state: "unclassified" }, labels: null }),
    f("00000008", { labels: L({ expression: "shock", gaze: "left" }) }),
  ];
  assert.deepEqual(rankFaces(pool, { count: 12 }).map((x) => x.id), ["00000004", "00000006", "00000003", "00000002", "00000008", "00000001"]);
  assert.deepEqual(rankFaces(pool, { expression: "shock" }).map((x) => x.id), ["00000008"]);
  assert.deepEqual(rankFaces(pool, { gaze: "left", minGrade: "hd" }).map((x) => x.id), ["00000008"]);
  assert.deepEqual(rankFaces(pool, { minGrade: "4k" }).map((x) => x.id), ["00000006"], "hidden 4k is excluded");
  assert.equal(rankFaces(pool, { count: 2 }).length, 2);
  assert.equal(rankFaces(pool, { gesture: "facepalm" }).length, 0);
  // The planner's pack: starred first, then one of each expression, capped.
  const sel = packSelection([...pool, f("00000009", { labels: L({ expression: "laugh" }) })], 4).map((x) => x.id);
  assert.equal(sel[0], "00000004");
  assert.equal(sel.length, 4);
  assert.ok(sel.includes("00000008") && sel.includes("00000009"));
});

test("use_face copies or really mirrors the cut-out; mirroring follows the owner's choice, then the pack default", async () => {
  const dataDir = tempDir();
  const projectDir = tempDir();
  // A cut-out whose left half is red and right half blue, so a flip is visible in the pixels.
  const raw = Buffer.alloc(8 * 2 * 3);
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 8; x += 1) raw.set(x < 4 ? [255, 0, 0] : [0, 0, 255], (y * 8 + x) * 3);
  const split = await sharp(raw, { raw: { width: 8, height: 2, channels: 3 } }).png().toBuffer();
  seedFace(dataDir, "aaaaaaaa");
  fs.writeFileSync(path.join(dataDir, "faces", "aaaaaaaa", "cutout.png"), split);
  seedFace(dataDir, "bbbbbbbb", { labels: L({ textOrLogoInShot: true }) });
  seedFace(dataDir, "cccccccc", { hidden: true });

  const plain = await takeFace(dataDir, projectDir, "aaaaaaaa");
  assert.equal(plain.name, "face-aaaaaaaa.png");
  assert.deepEqual(fs.readFileSync(path.join(projectDir, "assets", plain.name)), split);
  const mirrored = await takeFace(dataDir, projectDir, "aaaaaaaa", { mirror: true });
  assert.equal(mirrored.name, "face-aaaaaaaa-mirrored.png");
  const px = await sharp(path.join(projectDir, "assets", mirrored.name)).raw().toBuffer();
  assert.deepEqual([...px.subarray(0, 3)], [0, 0, 255], "the left pixel is now the right one");
  assert.deepEqual([...px.subarray(7 * 3, 7 * 3 + 3)], [255, 0, 0]);

  // Default: the owner is happy to mirror everything, text or not.
  assert.equal((await takeFace(dataDir, projectDir, "bbbbbbbb", { mirror: true })).mirrored, true);
  // Pack default off: the label decides.
  fs.writeFileSync(path.join(dataDir, "faces", "settings.json"), JSON.stringify({ mirrorAll: false }));
  await assert.rejects(takeFace(dataDir, projectDir, "bbbbbbbb", { mirror: true }), /Mirroring is not allowed/);
  assert.equal((await takeFace(dataDir, projectDir, "aaaaaaaa", { mirror: true })).mirrored, true, "no text or logo, so safe");
  // The per-face choice wins over both.
  const patch = (id, mirrorAllowed) => {
    const file = path.join(dataDir, "faces", id, "face.json");
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), mirrorAllowed }));
  };
  patch("bbbbbbbb", true);
  assert.equal((await takeFace(dataDir, projectDir, "bbbbbbbb", { mirror: true })).mirrored, true);
  patch("aaaaaaaa", false);
  await assert.rejects(takeFace(dataDir, projectDir, "aaaaaaaa", { mirror: true }), /not allowed/);
  assert.equal((await takeFace(dataDir, projectDir, "aaaaaaaa")).name, "face-aaaaaaaa.png", "unmirrored use is always fine");
  await assert.rejects(takeFace(dataDir, projectDir, "cccccccc"), /hid this face/);
  await assert.rejects(takeFace(dataDir, projectDir, "../etc"), /no face/);
  assert.equal(mirrorAllowedFor({ mirrorAllowed: null, labels: { textOrLogoInShot: true } }, { mirrorAll: true }), true);
});

test("the owner's mirroring setting and per-face choice go through the API", async () => {
  const { t, upload, list, settled } = await setup();
  try {
    assert.deepEqual((await t.api("GET", "/api/faces/settings")).body, { mirrorAll: true });
    assert.equal((await t.api("PUT", "/api/faces/settings", { mirrorAll: "no" })).status, 400);
    assert.deepEqual((await t.api("PUT", "/api/faces/settings", { mirrorAll: false })).body, { mirrorAll: false });
    assert.equal((await list()).settings.mirrorAll, false);
    await upload("p.png", makePng(32, 32), "image/png");
    const [face] = (await until(list, settled)).items;
    assert.equal(face.mirrorAllowed, null);
    assert.equal((await t.api("PATCH", `/api/faces/${face.id}`, { mirrorAllowed: true })).body.mirrorAllowed, true);
    assert.equal((await t.api("PATCH", `/api/faces/${face.id}`, { mirrorAllowed: null })).body.mirrorAllowed, null);
    assert.equal((await t.api("PATCH", `/api/faces/${face.id}`, { mirrorAllowed: "x" })).status, 400);
  } finally {
    await t.close();
  }
});

test("the render MCP serves find_faces (labels and a contact sheet) and use_face", async () => {
  const dataDir = tempDir();
  const projectDir = tempDir();
  fs.mkdirSync(path.join(projectDir, "assets"));
  seedFace(dataDir, "aaaaaaaa", { starred: true });
  seedFace(dataDir, "bbbbbbbb", { labels: L({ expression: "shock", gaze: "left", textOrLogoInShot: true }) });
  fs.writeFileSync(path.join(dataDir, "faces", "settings.json"), JSON.stringify({ mirrorAll: false }));
  const t = await startApp();
  const env = { ...process.env, IMAGO_PROJECT_DIR: projectDir, IMAGO_DATA_DIR: dataDir, IMAGO_FONTS_DIR: t.config.fontsDir, IMAGO_WIDTH: "1280", IMAGO_HEIGHT: "720", IMAGO_ELECTRON_BIN: t.config.electronBin, IMAGO_CHROMIUM_LIBS: t.config.chromiumLibs };
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [t.config.mcpScript], env }));
  try {
    const names = (await client.listTools()).tools.map((x) => x.name);
    assert.ok(names.includes("find_faces") && names.includes("use_face"));
    const found = await client.callTool({ name: "find_faces", arguments: { expression: "shock", gaze: "left" } });
    const json = JSON.parse(found.content.find((c) => c.type === "text").text);
    assert.equal(json.faces.length, 1);
    assert.equal(json.faces[0].id, "bbbbbbbb");
    assert.equal(json.faces[0].mirrorSafe, false);
    assert.equal(json.faces[0].grade, "hd");
    if ((await t.api("GET", "/api/capabilities")).body.renderer.state === "ready") {
      const image = found.content.find((c) => c.type === "image");
      assert.ok(image, "a contact sheet image comes with the matches");
      if (process.env.FACE_SHEET_OUT) fs.writeFileSync(process.env.FACE_SHEET_OUT, Buffer.from(image.data, "base64"));
    }
    const none = await client.callTool({ name: "find_faces", arguments: { gesture: "facepalm" } });
    assert.match(none.content[0].text, /No face matches/);
    const refused = await client.callTool({ name: "use_face", arguments: { id: "bbbbbbbb", mirror: true } });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /not allowed/);
    const ok = await client.callTool({ name: "use_face", arguments: { id: "bbbbbbbb" } });
    assert.equal(JSON.parse(ok.content[0].text).name, "face-bbbbbbbb.png");
    const flipped = await client.callTool({ name: "use_face", arguments: { id: "aaaaaaaa", mirror: true } });
    assert.equal(JSON.parse(flipped.content[0].text).name, "face-aaaaaaaa-mirrored.png");
    assert.ok(fs.existsSync(path.join(projectDir, "assets", "face-aaaaaaaa-mirrored.png")));
  } finally {
    await client.close();
    await t.close();
  }
});

test("planner wiring: face ids are validated, spread across concepts and used by the fallback", () => {
  const assets = new Set(["kit-f01.jpg"]);
  const faces = new Set(["aaaaaaaa", "bbbbbbbb"]);
  const c = (extra = {}) => ({ archetype: "reaction", label: "L", idea: "i", text: "WOW", why: "w", ...extra });
  const ok = validateConcepts({ concepts: [c({ face: "aaaaaaaa" }), c({ archetype: "number" })] }, { count: 2, assets, faces });
  assert.equal(ok.ok, true);
  assert.equal(ok.concepts[0].face, "aaaaaaaa");
  assert.equal(ok.concepts[1].face, undefined);
  const bad = validateConcepts({ concepts: [c({ face: "deadbeef" }), c({ archetype: "number" })] }, { count: 2, assets, faces });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /face pack/);
  assert.equal(validateConcepts({ concepts: [c({ face: "aaaaaaaa" })] }, { count: 1, assets }).ok, false, "no pack, no face");
  const same = diversifyFaces([{ face: "aaaaaaaa" }, { face: "aaaaaaaa" }, { archetype: "x" }], ["aaaaaaaa", "bbbbbbbb"]);
  assert.deepEqual(same.map((x) => x.face), ["aaaaaaaa", "bbbbbbbb", undefined]);
  assert.deepEqual(diversifyFaces([{ face: "aaaaaaaa" }, { face: "aaaaaaaa" }], ["aaaaaaaa"]).map((x) => x.face), ["aaaaaaaa", "aaaaaaaa"], "a one-face pack may repeat");
  const fb = fallbackConcepts({ count: 3, packFaces: ["aaaaaaaa", "bbbbbbbb", "cccccccc"] });
  assert.deepEqual(fb.map((x) => x.face), ["aaaaaaaa", "bbbbbbbb", "cccccccc"]);
  const withKit = fallbackConcepts({ count: 2, uploads: ["me.jpg"], packFaces: ["aaaaaaaa"] });
  assert.ok(withKit.every((x) => x.face === undefined), "a real frame of a person comes first");
});

test("a concept set uses the pack: the planner sees the sheet, each concept gets its own face cut-out", async () => {
  const argsFile = path.join(tempDir(), "args.jsonl");
  const t = await startApp({}, { cutOutFile: fakeCutOutFile });
  try {
    const ids = ["aaaaaaaa", "bbbbbbbb", "cccccccc"];
    ids.forEach((id, i) => seedFace(t.dataDir, id, { labels: L({ expression: ["smile", "shock", "angry"][i] }) }));
    await withEnv({ FAKE_CLAUDE_ARGS_OUT: argsFile }, async () => {
      const set = (await t.api("POST", "/api/concept-sets", { title: "Pack test", brief: { title: "Pack test" }, count: 2 })).body;
      await t.api("POST", `/api/concept-sets/${set.id}/start`);
      const done = await until(async () => (await t.api("GET", `/api/concept-sets/${set.id}`)).body, (s) => ["done", "failed"].includes(s.state), 90_000);
      assert.equal(done.state, "done", JSON.stringify(done.concepts.map((c) => c.error)));
      assert.equal(done.plan.source, "planner", done.plan.note);
      const faceIds = done.concepts.map((c) => c.face);
      assert.ok(faceIds.every(Boolean), JSON.stringify(done));
      assert.equal(new Set(faceIds).size, 2, "different faces");
      for (const c of done.concepts) {
        const p = (await t.api("GET", `/api/projects/${c.projectId}`)).body;
        const asset = p.assets.find((a) => a.kind === "face");
        assert.equal(asset.name, `face-${c.face}.png`);
        assert.equal(asset.faceId, c.face);
        assert.ok(fs.existsSync(path.join(t.dataDir, "projects", c.projectId, "assets", asset.name)));
      }
      const calls = readCalls(argsFile);
      const planner = calls.find((x) => /concept planner/.test(x.systemPrompt ?? ""));
      assert.match(planner.stdin, /face pack of 3/);
      const designs = calls.filter((x) => /Your concept/.test(x.systemPrompt ?? ""));
      assert.ok(designs.every((x) => /Its face is assets\/face-[a-f0-9]{8}\.png/.test(x.stdin)));
      assert.ok(designs.every((x) => /Face from the owner's face pack/.test(x.systemPrompt)));
      assert.ok(designs.every((x) => flagOf(x.argv, "--allowedTools").includes("mcp__imago__use_face")));
      assert.ok(!fs.existsSync(path.join(t.dataDir, "concept-sets", set.id, "work", "faces")), "the planner's copies of the pack are removed afterwards");
    });
    // A planner that names a face the pack does not have falls back.
    await withEnv({ FAKE_CLAUDE_PLANNER: "badface" }, async () => {
      const set = (await t.api("POST", "/api/concept-sets", { title: "Pack bad", brief: { title: "Pack bad" }, count: 2 })).body;
      await t.api("POST", `/api/concept-sets/${set.id}/start`);
      const done = await until(async () => (await t.api("GET", `/api/concept-sets/${set.id}`)).body, (s) => ["done", "failed"].includes(s.state), 90_000);
      assert.equal(done.plan.source, "fallback");
      assert.match(done.plan.note, /face pack/);
      assert.ok(done.concepts.every((c) => c.face), "the fallback still uses the pack's faces");
    });
  } finally {
    await t.close();
  }
});
