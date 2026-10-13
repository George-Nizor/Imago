// The thumbnail brief's face source: the owner's pack, the video's own frames, or Claude's choice.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fallbackConcepts, validateConcepts } from "../server/concept-sets.mjs";
import { kitPromptSection, validateKitManifest } from "../server/kits.mjs";
import { buildFirstPrompt } from "../server/presets/index.mjs";
import { makePng, startApp, tempDir } from "./helpers.mjs";
import { kitManifest, writeKit } from "./fixtures/kit.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, ok, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`timed out; last: ${JSON.stringify(value).slice(0, 400)}`);
    await sleep(80);
  }
}
const readCalls = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

function seedFace(dataDir, id, over = {}) {
  const dir = path.join(dataDir, "faces", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "cutout.png"), makePng(40, 60, [200, 40, 40]));
  fs.writeFileSync(path.join(dir, "thumb.png"), makePng(20, 30, [200, 40, 40]));
  fs.writeFileSync(path.join(dir, "original.png"), makePng(40, 60));
  fs.writeFileSync(path.join(dir, "face.json"), JSON.stringify({
    schemaVersion: 1, id, addedAt: "2026-10-01T10:00:00.000Z", filename: "me.png",
    original: { file: "original.png", width: 40, height: 60, bytes: 1 },
    cutout: { state: "done", width: 40, height: 60, thumb: true },
    classification: { state: "done", reason: "" },
    labels: { expression: "shock", intensity: 3, gesture: "none", gaze: "left", eyesOpen: true, headTurn: "frontal", faceBox: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, textOrLogoInShot: false, description: "Shocked" },
    labelsEditedByOwner: false, mirrorAllowed: null, quality: { grade: "4k", faceHeightPx: 1100, sharpness: 100 }, starred: false, hidden: false, ...over,
  }));
}

async function setup({ withPack = true } = {}) {
  const root = tempDir();
  writeKit(root);
  const t = await startApp({ fabulaRoots: [root] });
  if (withPack) {
    seedFace(t.dataDir, "aaaaaaaa");
    seedFace(t.dataDir, "bbbbbbbb", { labels: { expression: "smile", intensity: 2, gesture: "none", gaze: "right", eyesOpen: true, headTurn: "frontal", faceBox: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, textOrLogoInShot: false, description: "Smile" } });
  }
  const kit = (await t.api("GET", "/api/kits")).body.items[0];
  return { t, kit };
}
const kitAssets = (p) => p.assets.filter((a) => a.kind === "kit").map((a) => a.name).sort();

test("the face source defaults to the pack when it has ready faces, else the video, and bad values are refused", async () => {
  const { t, kit } = await setup({ withPack: false });
  try {
    assert.equal((await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x" } })).body.brief.faceSource, "video");
    assert.equal((await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x", faceSource: "pack" } })).body.error.code, "NO_PACK_FACES");
    assert.equal((await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x", faceSource: "auto" }, kit: kit.id })).body.brief.faceSource, "auto");
    seedFace(t.dataDir, "aaaaaaaa");
    assert.equal((await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x" } })).body.brief.faceSource, "pack", "the default whenever the pack has ready faces");
    assert.equal((await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x", faceSource: "video" } })).body.brief.faceSource, "video");
    assert.equal((await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x", faceSource: "mine" } })).body.error.code, "BAD_FACE_SOURCE");
    // A face that is hidden or not classified is not ready.
    fs.rmSync(path.join(t.dataDir, "faces", "aaaaaaaa"), { recursive: true });
    seedFace(t.dataDir, "cccccccc", { hidden: true });
    assert.equal((await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x" } })).body.brief.faceSource, "video");
  } finally {
    await t.close();
  }
});

test("pack: the kit's face frames are not imported; screens, pictures and the story are, and the prompt says so", async () => {
  const { t, kit } = await setup();
  try {
    const p = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "Game" }, kit: kit.id })).body;
    assert.equal(p.brief.faceSource, "pack");
    assert.deepEqual(kitAssets(p), ["kit-boss-billy.png", "kit-contact-sheet.png", "kit-logo.png", "kit-s01.jpg"]);
    assert.ok(!fs.existsSync(path.join(t.dataDir, "projects", p.id, "assets", "kit-f01.jpg")));
    const argsFile = path.join(tempDir(), "args.jsonl");
    process.env.FAKE_CLAUDE_ARGS_OUT = argsFile;
    try {
      await t.api("POST", `/api/projects/${p.id}/messages`, { text: "Make it" });
      const [call] = await until(() => readCalls(argsFile), (c) => c.length >= 1);
      assert.match(call.stdin, /Face source: the owner's face pack/);
      assert.match(call.stdin, /left out on purpose/);
      assert.ok(!/kit-f01|kit-f02/.test(call.stdin), "no face frame row");
      assert.match(call.stdin, /kit-s01\.jpg/);
      assert.match(call.stdin, /Ten thousand copies/);
      assert.match(call.stdin, /Palette: accent #E8413C/);
      assert.ok(!/\| quality \|/.test(call.stdin));
    } finally {
      delete process.env.FAKE_CLAUDE_ARGS_OUT;
    }
  } finally {
    await t.close();
  }
});

test("video imports everything as before; auto grades the face frames like pack faces", async () => {
  const { t, kit } = await setup();
  try {
    const video = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "Game", faceSource: "video" }, kit: kit.id })).body;
    assert.ok(kitAssets(video).includes("kit-f01.jpg") && kitAssets(video).includes("kit-f02.jpg"));
    assert.ok(video.assets.every((a) => a.quality === undefined), "no grading unless asked");

    const auto = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "Game", faceSource: "auto" }, kit: kit.id })).body;
    assert.ok(kitAssets(auto).includes("kit-f01.jpg"));
    const f01 = auto.assets.find((a) => a.name === "kit-f01.jpg");
    assert.ok(["soft", "hd", "4k"].includes(f01.quality.grade), JSON.stringify(f01.quality));
    assert.equal(typeof f01.quality.faceHeightPx, "number");
    assert.equal(auto.assets.find((a) => a.name === "kit-s01.jpg").quality, undefined, "screens are not graded");
    const argsFile = path.join(tempDir(), "args.jsonl");
    process.env.FAKE_CLAUDE_ARGS_OUT = argsFile;
    try {
      await t.api("POST", `/api/projects/${auto.id}/messages`, { text: "Make it" });
      const [call] = await until(() => readCalls(argsFile), (c) => c.length >= 1);
      assert.match(call.stdin, /\| quality \|/);
      assert.match(call.stdin, new RegExp(`kit-f01\\.jpg \\| face \\|[^\\n]*\\| ${f01.quality.grade} \\|`));
      assert.match(call.stdin, /Face quality: 4k/);
      assert.match(call.stdin, /Face source: your choice/);
    } finally {
      delete process.env.FAKE_CLAUDE_ARGS_OUT;
    }
  } finally {
    await t.close();
  }
});

test("kitPromptSection: the grade column only with auto, face rows dropped with pack", () => {
  const kit = validateKitManifest(kitManifest());
  const auto = kitPromptSection(kit, { faceSource: "auto", grades: { "frames/f01.jpg": "hd" } });
  assert.match(auto, /\| quality \|/);
  assert.match(auto, /frames\/f01|kit-f01\.jpg \| face \|[^\n]*\| hd \|/);
  assert.match(auto, /kit-f02\.jpg \| face \|[^\n]*\| n\/a \|/);
  const pack = kitPromptSection(kit, { faceSource: "pack" });
  assert.ok(!pack.includes("kit-f01.jpg") && pack.includes("kit-s01.jpg"));
  const video = kitPromptSection(kit, {});
  assert.ok(video.includes("kit-f01.jpg") && !video.includes("quality"));
});

test("the first prompt names the face source", () => {
  const project = { preset: "thumbnail", brief: { title: "T", faceSource: "pack" } };
  assert.match(buildFirstPrompt(project, "Go"), /Face source: the owner's face pack \(find_faces, then use_face\)/);
  assert.match(buildFirstPrompt(project, "Go"), /never stands in for a moment or result the video did not capture/);
  assert.ok(!buildFirstPrompt({ preset: "thumbnail", brief: { title: "T" } }, "Go").includes("Face source"));
});

test("concept plans: the pack requires a face per concept, and the fallback gives them", () => {
  const assets = new Set(["kit-s01.jpg"]);
  const c = (extra = {}) => ({ archetype: "reaction", label: "L", idea: "I", text: "WOW", why: "W", ...extra });
  const plan = (cs) => ({ concepts: cs });
  const faces = new Set(["aaaaaaaa", "bbbbbbbb"]);
  assert.equal(validateConcepts(plan([c({ face: "aaaaaaaa" }), c({ archetype: "number", face: "bbbbbbbb" })]), { count: 2, assets, faces, requireFace: true }).ok, true);
  const missing = validateConcepts(plan([c({ face: "aaaaaaaa" }), c({ archetype: "number" })]), { count: 2, assets, faces, requireFace: true });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /pack face/);
  assert.equal(validateConcepts(plan([c(), c({ archetype: "number" })]), { count: 2, assets, faces }).ok, true, "optional otherwise");

  const kit = validateKitManifest(kitManifest());
  const records = kit.frames.map((f) => ({ name: `kit-${f.file.split("/")[1]}`, kitFile: f.file }));
  const withFrames = fallbackConcepts({ count: 3, kit, records, packFaces: ["aaaaaaaa", "bbbbbbbb"] });
  assert.ok(withFrames.every((x) => !x.face), "without the pack as the source, a real frame wins");
  const pack = fallbackConcepts({ count: 3, kit, records: records.filter((r) => !/f0[12]/.test(r.kitFile)), uploads: ["me.png"], packFaces: ["aaaaaaaa", "bbbbbbbb"], preferPack: true });
  assert.ok(pack.filter((x) => x.face).length >= 2);
  assert.ok(pack.every((x) => !x.face || ["aaaaaaaa", "bbbbbbbb"].includes(x.face)));
  assert.ok(pack.every((x) => x.frame !== "assets/me.png"), "an upload does not displace the pack");
});

test("a concept set with face source pack: no face frames, the planner must pick pack faces, the fallback does too", async () => {
  const { t, kit } = await setup();
  const argsFile = path.join(tempDir(), "args.jsonl");
  process.env.FAKE_CLAUDE_ARGS_OUT = argsFile;
  try {
    const draft = (await t.api("POST", "/api/concept-sets", { count: 2, brief: {}, kit: kit.id })).body;
    const projects = (await t.api("GET", "/api/projects")).body.items;
    for (const item of projects) {
      const p = (await t.api("GET", `/api/projects/${item.id}`)).body;
      assert.equal(p.brief.faceSource, "pack");
      assert.ok(!kitAssets(p).some((n) => /kit-f0[12]/.test(n)));
      assert.ok(kitAssets(p).includes("kit-s01.jpg") && kitAssets(p).includes("kit-contact-sheet.png"));
    }
    assert.equal((await t.api("POST", `/api/concept-sets/${draft.id}/start`)).status, 202);
    const set = await until(async () => (await t.api("GET", `/api/concept-sets/${draft.id}`)).body, (s) => ["done", "failed"].includes(s.state));
    assert.equal(set.plan.source, "planner");
    assert.ok(set.concepts.every((c) => /^[a-f0-9]{8}$/.test(c.face)), "every concept has a pack face");
    assert.equal(new Set(set.concepts.map((c) => c.face)).size, 2);
    const planner = readCalls(argsFile).find((c) => /concept planner/.test(c.systemPrompt ?? ""));
    assert.match(planner.systemPrompt, /## Face source/);
    assert.match(planner.stdin, /Face source: the owner's face pack/);
    assert.match(planner.stdin, /Every concept must set "face" to a different pack id/);
    assert.match(planner.stdin, /gaze points toward the side the text will take/);
    assert.ok(!/kit-f01/.test(planner.stdin));
    const designs = readCalls(argsFile).filter((c) => /## Your concept/.test(c.systemPrompt ?? ""));
    assert.ok(designs.every((d) => /Its face is assets\/face-[a-f0-9]{8}\.png/.test(d.stdin)), "the face is placed before the design turn");
  } finally {
    delete process.env.FAKE_CLAUDE_ARGS_OUT;
    await t.close();
  }
});

test("a planner that forgets the faces makes the plan unusable and the fallback uses the pack", async () => {
  const { t, kit } = await setup();
  const argsFile = path.join(tempDir(), "args.jsonl");
  process.env.FAKE_CLAUDE_ARGS_OUT = argsFile;
  process.env.FAKE_CLAUDE_PLANNER = "missing";
  try {
    const draft = (await t.api("POST", "/api/concept-sets", { count: 3, brief: {}, kit: kit.id })).body;
    await t.api("POST", `/api/concept-sets/${draft.id}/start`);
    const set = await until(async () => (await t.api("GET", `/api/concept-sets/${draft.id}`)).body, (s) => ["done", "failed"].includes(s.state));
    assert.equal(set.plan.source, "fallback");
    assert.ok(set.concepts.filter((c) => c.face).length >= 2, "fallback concepts use pack faces");
    assert.ok(set.concepts.every((c) => !c.frame || !/kit-f0/.test(c.frame)));
  } finally {
    delete process.env.FAKE_CLAUDE_ARGS_OUT;
    delete process.env.FAKE_CLAUDE_PLANNER;
    await t.close();
  }
});
