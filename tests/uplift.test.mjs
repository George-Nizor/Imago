// The uplift: baked sticker outlines and the size cap, the drop-shadow warning, "Refresh faces" without a turn, "Try other
// faces" sets, title A/B sets and the exports list. Everything runs on the fake claude.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";
import { registerFace } from "../server/assets.mjs";
import { repeatsTitle, validateConcepts } from "../server/concept-sets.mjs";
import { MAX_FACE_SIDE, bakeSticker, limitFaceSize, resolveSticker } from "../server/face-sticker.mjs";
import { pickVariantFaces, takeFace } from "../server/face-pack.mjs";
import { validateDesign } from "../server/validate.mjs";
import { makePng, startApp, tempDir } from "./helpers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, ok, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`timed out; last: ${JSON.stringify(value).slice(0, 600)}`);
    await sleep(80);
  }
}
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
const readCalls = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];
const L = (over) => ({ expression: "smile", intensity: 2, gesture: "none", gaze: "camera", eyesOpen: true, headTurn: "frontal", faceBox: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, textOrLogoInShot: false, description: "x", ...over });

/** A face folder as the server leaves it; `png` is the cut-out (default a small solid one). */
function seedFace(dataDir, id, over = {}, png = makePng(40, 60, [200, 40, 40])) {
  const dir = path.join(dataDir, "faces", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "cutout.png"), png);
  fs.writeFileSync(path.join(dir, "thumb.png"), makePng(20, 30, [200, 40, 40]));
  fs.writeFileSync(path.join(dir, "original.png"), makePng(40, 60));
  const face = {
    schemaVersion: 1, id, addedAt: "2026-10-01T10:00:00.000Z", filename: "me.png",
    original: { file: "original.png", width: 40, height: 60, bytes: 1 },
    cutout: { state: "done", width: 40, height: 60, thumb: true },
    classification: { state: "done", reason: "" },
    labels: L({}), labelsEditedByOwner: false, mirrorAllowed: null,
    quality: { grade: "hd", faceHeightPx: 600, sharpness: 100 }, starred: false, hidden: false,
    ...over,
  };
  fs.writeFileSync(path.join(dir, "face.json"), JSON.stringify(face));
  return face;
}

/** A transparent canvas with one solid red disc: the subject's alpha is exactly known. */
async function disc(size = 400, radius = 100) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="#d22"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const pixelAt = async (png, x, y) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * 4;
  return [...data.subarray(o, o + 4)];
};

// ---- 1. the sticker -------------------------------------------------------------------------------

test("a sticker bakes ink then cream then the subject, at the radii asked for", async () => {
  const bytes = await disc(400, 100);
  // 400 px shown at 200 CSS px: 2 source px per CSS px, so cream reaches 16 px and ink 26 px from the disc.
  const sticker = await resolveSticker({ cream: "#FFFFFF", ink: "#000000", displayWidth: 200 }, tempDir());
  const baked = await bakeSticker(bytes, sticker);
  const pad = (baked.width - 400) / 2;
  assert.ok(pad >= 26 && pad <= 31, `padding ${pad}`);
  const at = (dx) => pixelAt(baked.data, pad + 200 + 100 + dx, pad + 200);
  assert.deepEqual((await at(-20)).slice(0, 3), [0xdd, 0x22, 0x22], "inside is the subject");
  assert.deepEqual(await at(8), [255, 255, 255, 255], "8 px out is cream");
  assert.deepEqual(await at(20), [0, 0, 0, 255], "20 px out is ink");
  assert.equal((await at(34))[3], 0, "past the outline it is transparent");
  assert.equal((await pixelAt(baked.data, 0, 0))[3], 0, "the corner is clear");
  // The display numbers put the face back where the plain cut-out would sit.
  assert.equal(baked.display.width, Math.round(((baked.width / 400) * 200) * 100) / 100);
  assert.ok(Math.abs(baked.display.offset - pad / 2) < 0.1);
  // Round: a diagonal point at the same distance is cream too.
  const d = Math.round((16 - 3) / Math.SQRT2);
  assert.deepEqual((await pixelAt(baked.data, pad + 300 + d + 1, pad + 200 + d + 1)).slice(0, 3), [255, 255, 255]);
});

test("a sticker never passes 2400 px, whatever the cut-out, and refuses a bad colour", async () => {
  const big = await sharp({ create: { width: 3392, height: 2544, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 1200, height: 1800, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } } }, left: 1000, top: 400 }])
    .png().toBuffer();
  const baked = await bakeSticker(big, await resolveSticker(true, tempDir()));
  assert.ok(Math.max(baked.width, baked.height) <= MAX_FACE_SIDE, `${baked.width}x${baked.height}`);
  assert.ok(baked.data.length < 4_000_000);
  await assert.rejects(resolveSticker({ cream: "cream" }, tempDir()), /hex colour/);
  await assert.rejects(resolveSticker({ displayWidth: 5 }, tempDir()), /displayWidth/);
  assert.equal(await resolveSticker(false, tempDir()), null);
  const small = await limitFaceSize(await disc(400, 100));
  assert.equal(small, null, "an image that fits is left alone");
  const shrunk = await limitFaceSize(big);
  assert.equal(Math.max(shrunk.width, shrunk.height), MAX_FACE_SIDE);
});

test("the sticker takes the brand's light and ink colours when the project has a brand", async () => {
  const projectDir = tempDir();
  fs.mkdirSync(path.join(projectDir, "reference"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "reference", "brand.json"), JSON.stringify({ colours: [{ name: "Paper", hex: "#EEDDCC", role: "light" }, { name: "Coal", hex: "#112233", role: "ink" }, { name: "Pop", hex: "#FF0000", role: "accent" }], fonts: {} }));
  const sticker = await resolveSticker(true, projectDir);
  assert.equal(sticker.cream, "#EEDDCC");
  assert.equal(sticker.ink, "#112233");
  assert.equal((await resolveSticker({ ink: "#000" }, projectDir)).ink, "#000", "an explicit colour wins");
  assert.equal((await resolveSticker(true, tempDir())).cream, "#F6EFDC", "no brand, the default cream");
});

test("use_face downscales to 2400 px, keeps small faces byte for byte and names the variants", async () => {
  const dataDir = tempDir();
  const projectDir = tempDir();
  const wide = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 1 } } }).png().toBuffer();
  seedFace(dataDir, "aaaaaaaa", {}, wide);
  seedFace(dataDir, "bbbbbbbb");
  const plain = await takeFace(dataDir, projectDir, "aaaaaaaa");
  assert.equal(plain.name, "face-aaaaaaaa.png");
  assert.deepEqual([plain.width, plain.height], [2400, 1600]);
  assert.equal((await sharp(path.join(projectDir, "assets", plain.name)).metadata()).width, 2400);
  const mirrored = await takeFace(dataDir, projectDir, "aaaaaaaa", { mirror: true, sticker: { displayWidth: 900 } });
  assert.equal(mirrored.name, "face-aaaaaaaa-mirrored-sticker.png");
  assert.ok(Math.max(mirrored.width, mirrored.height) <= MAX_FACE_SIDE);
  assert.equal(mirrored.sticker.displayWidth, 900);
  assert.ok(mirrored.display.offset > 0 && mirrored.stamp.file === "cutout.png");
  assert.equal((await takeFace(dataDir, projectDir, "bbbbbbbb", { sticker: true })).name, "face-bbbbbbbb-sticker.png");
  const small = await takeFace(dataDir, projectDir, "bbbbbbbb");
  assert.deepEqual(fs.readFileSync(path.join(projectDir, "assets", small.name)), fs.readFileSync(path.join(dataDir, "faces", "bbbbbbbb", "cutout.png")));
});

test("the render MCP's use_face takes the sticker option", async () => {
  const dataDir = tempDir();
  const projectDir = tempDir();
  fs.mkdirSync(path.join(projectDir, "assets"));
  seedFace(dataDir, "aaaaaaaa", {}, await disc(300, 80));
  const t = await startApp();
  const env = { ...process.env, IMAGO_PROJECT_DIR: projectDir, IMAGO_DATA_DIR: dataDir, IMAGO_FONTS_DIR: t.config.fontsDir, IMAGO_WIDTH: "1280", IMAGO_HEIGHT: "720", IMAGO_ELECTRON_BIN: t.config.electronBin, IMAGO_CHROMIUM_LIBS: t.config.chromiumLibs };
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [t.config.mcpScript], env }));
  try {
    const tool = (await client.listTools()).tools.find((x) => x.name === "use_face");
    assert.ok(tool.inputSchema.properties.sticker, "the schema offers sticker");
    const reply = await client.callTool({ name: "use_face", arguments: { id: "aaaaaaaa", sticker: { cream: "#ffffff", ink: "#000000", displayWidth: 300 } } });
    const made = JSON.parse(reply.content[0].text);
    assert.equal(made.name, "face-aaaaaaaa-sticker.png");
    assert.ok(made.display.width > 300 && made.display.offset > 0);
    assert.ok(fs.existsSync(path.join(projectDir, "assets", made.name)));
    const bad = await client.callTool({ name: "use_face", arguments: { id: "aaaaaaaa", sticker: { cream: "nope" } } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    await t.close();
  }
});

test("more than five drop-shadow() filters on one element is a warning, five is not", () => {
  const stack = (n) => Array.from({ length: n }, (_, i) => `drop-shadow(0 0 ${i + 1}px #fff)`).join(" ");
  const page = (css, body = "") => `<!doctype html><html><head><style>html,body{margin:0}body{width:100px;height:50px;overflow:hidden}${css}</style></head><body>${body}</body></html>`;
  const warn = (html) => validateDesign(html, { width: 100, height: 50 }).warnings.filter((w) => /drop-shadow/.test(w));
  assert.equal(warn(page(`.face{filter:${stack(5)}}`)).length, 0);
  const six = warn(page(`.face{filter:brightness(1.1) ${stack(6)}}`));
  assert.equal(six.length, 1);
  assert.match(six[0], /"\.face" stacks 6 drop-shadow\(\) filters/);
  assert.match(six[0], /sticker/);
  assert.equal(warn(page("", `<img style="filter:${stack(9)}">`)).length, 1, "an inline style counts too");
  assert.equal(warn(page(`.a{filter:${stack(4)}}.b{filter:${stack(4)}}`)).length, 0, "the count is per element, not per page");
  assert.equal(validateDesign(page(`.face{filter:${stack(14)}}`), { width: 100, height: 50 }).errors.length, 0, "a warning, never an error");
});

// ---- 2 and 3: faces inside a project --------------------------------------------------------------

/** A project whose design uses `faceId` (placed like use_face would, then a fake turn designs around it). */
async function designWithFace(t, faceId, options = {}) {
  const p = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "Face test" } })).body;
  const dir = t.app.store.dirOf(p.id);
  const made = await takeFace(t.dataDir, dir, faceId, options);
  await registerFace(t.app.store, p.id, { name: made.name, width: made.width, height: made.height, faceId, mirrored: made.mirrored, stamp: made.stamp, sticker: made.sticker, display: made.display });
  assert.equal((await t.api("POST", `/api/projects/${p.id}/messages`, { text: "Make it" })).status, 202);
  const done = await until(async () => (await t.api("GET", `/api/projects/${p.id}`)).body, (x) => !x.running && x.versions.length >= 1);
  return { id: p.id, dir, project: done, made };
}
const getProject = async (t, id) => (await t.api("GET", `/api/projects/${id}`)).body;
const touchLater = (file, bytes) => {
  fs.writeFileSync(file, bytes);
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(file, later, later);
};

test("a project knows its pack face is newer; Refresh faces re-copies it, renders a version and spends no turn", async () => {
  const t = await startApp();
  const argsFile = path.join(tempDir(), "args.jsonl");
  try {
    seedFace(t.dataDir, "aaaaaaaa", {}, await disc(300, 80));
    seedFace(t.dataDir, "bbbbbbbb", {}, await disc(300, 80));
    const made = await withEnv({ FAKE_CLAUDE_ARGS_OUT: argsFile }, () => designWithFace(t, "aaaaaaaa", { sticker: { displayWidth: 300 } }));
    const turnsBefore = readCalls(argsFile).length;
    assert.equal(turnsBefore, 1);
    // The turn's own copy is registered with what a refresh needs.
    const asset = made.project.assets.find((a) => a.kind === "face");
    assert.equal(asset.name, "face-aaaaaaaa-sticker.png");
    assert.equal(asset.stamp.file, "cutout.png");
    assert.equal(asset.sticker.displayWidth, 300);

    const status = async () => (await t.api("GET", `/api/projects/${made.id}/face-status`)).body;
    assert.deepEqual(await status(), { faces: [{ id: "aaaaaaaa", state: "current", assets: ["face-aaaaaaaa-sticker.png"] }], stale: 0 });

    // The owner re-retouches the face: the pack's file is newer than the project's copy.
    const before = fs.readFileSync(path.join(made.dir, "assets", asset.name));
    touchLater(path.join(t.dataDir, "faces", "aaaaaaaa", "cutout.png"), await disc(300, 120));
    const stale = await status();
    assert.equal(stale.stale, 1);
    assert.equal(stale.faces[0].state, "stale");
    assert.equal((await t.api("GET", "/api/faces/aaaaaaaa/projects")).body.items[0].stale, true);
    assert.equal((await t.api("GET", "/api/faces/bbbbbbbb/projects")).body.items.length, 0);

    const refreshed = await t.api("POST", `/api/projects/${made.id}/refresh-faces`);
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.equal(refreshed.body.version, 2);
    assert.deepEqual(refreshed.body.refreshed, ["face-aaaaaaaa-sticker.png"]);
    const next = await getProject(t, made.id);
    assert.equal(next.current, 2);
    assert.equal(next.versions.length, 2);
    assert.equal(next.versions[1].note, "faces refreshed");
    assert.match(next.messages.at(-1).text, /Refreshed the face/);
    assert.equal(next.messages.at(-1).version, 2);
    assert.ok(fs.existsSync(path.join(made.dir, "renders", "v2.png")) && fs.existsSync(path.join(made.dir, "versions", "v2.html")));
    assert.ok(!fs.readFileSync(path.join(made.dir, "assets", asset.name)).equals(before), "the copy was replaced");
    assert.equal(next.assets.find((a) => a.kind === "face").sticker.displayWidth, 300, "the sticker variant is kept");
    assert.equal((await status()).stale, 0);
    assert.equal(readCalls(argsFile).length, turnsBefore, "no Claude turn was run");
    // The refresh is recorded like a render: the restore of the earlier version is still possible.
    assert.equal((await t.api("POST", `/api/projects/${made.id}/restore`, { version: 1 })).status, 200);

    // From the Faces page: refresh a face in every project that holds an old copy.
    touchLater(path.join(t.dataDir, "faces", "aaaaaaaa", "cutout.png"), await disc(300, 60));
    const everywhere = await t.api("POST", "/api/faces/aaaaaaaa/refresh-projects", {});
    assert.equal(everywhere.status, 200);
    assert.deepEqual(everywhere.body.results.map((r) => [r.id, r.ok]), [[made.id, true]]);
    assert.equal((await getProject(t, made.id)).versions.length, 3);
    assert.deepEqual((await t.api("POST", "/api/faces/aaaaaaaa/refresh-projects", {})).body.results, [], "nothing is out of date any more");

    // Nothing to refresh, a face that left the pack, and a running turn.
    const plain = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "No face" } })).body;
    assert.equal((await t.api("POST", `/api/projects/${plain.id}/refresh-faces`)).body.error.code, "NO_FACES");
    fs.rmSync(path.join(t.dataDir, "faces", "aaaaaaaa"), { recursive: true });
    assert.equal((await status()).faces[0].state, "unavailable");
    const gone = await t.api("POST", `/api/projects/${made.id}/refresh-faces`);
    assert.equal(gone.status, 409);
    assert.equal(gone.body.error.code, "NOTHING_REFRESHED");
  } finally {
    await t.close();
  }
});

test("Refresh faces keeps the mirrored copy and is refused while a turn runs", async () => {
  const t = await startApp();
  try {
    seedFace(t.dataDir, "aaaaaaaa", {}, await disc(300, 80));
    const made = await designWithFace(t, "aaaaaaaa", { mirror: true });
    assert.equal(made.project.assets.find((a) => a.kind === "face").mirrored, true);
    await withEnv({ FAKE_CLAUDE_MODE: "slow" }, async () => {
      await t.api("POST", `/api/projects/${made.id}/messages`, { text: "again" });
      await until(async () => (await getProject(t, made.id)).running, Boolean);
      assert.equal((await t.api("POST", `/api/projects/${made.id}/refresh-faces`)).body.error.code, "TURN_RUNNING");
      await t.api("POST", `/api/projects/${made.id}/cancel`);
      await until(async () => (await getProject(t, made.id)).running, (r) => !r);
    });
    const refreshed = await t.api("POST", `/api/projects/${made.id}/refresh-faces`);
    assert.deepEqual(refreshed.body.refreshed, ["face-aaaaaaaa-mirrored.png"]);
    // Mirroring switched off for that face since: the old copy stays and the refresh says why.
    const file = path.join(t.dataDir, "faces", "aaaaaaaa", "face.json");
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), mirrorAllowed: false }));
    const refused = await t.api("POST", `/api/projects/${made.id}/refresh-faces`);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /Mirroring is not allowed/);
  } finally {
    await t.close();
  }
});

test("variants pick distinct expressions, best quality first, and never the face already in use", () => {
  const f = (id, expression, grade, over = {}) => ({ id, addedAt: "2026-10-01", cutout: { state: "done" }, classification: { state: "done" }, labels: L({ expression }), quality: { grade, sharpness: 100 }, ...over });
  const pack = [f("aaaaaaaa", "smile", "hd"), f("bbbbbbbb", "smile", "4k", { starred: true }), f("cccccccc", "shock", "soft"), f("dddddddd", "angry", "hd"), f("eeeeeeee", "shock", "4k"), f("ffffffff", "sad", "hd", { hidden: true })];
  const ids = (list) => list.map((x) => x.id);
  const three = pickVariantFaces(pack, { count: 3, exclude: ["aaaaaaaa"], avoidExpression: "smile" });
  assert.deepEqual(ids(three), ["eeeeeeee", "dddddddd", "bbbbbbbb"], "shock (4k), angry, then the smile once the others are used");
  assert.equal(new Set(three.slice(0, 2).map((x) => x.labels.expression)).size, 2);
  assert.ok(!ids(three).includes("aaaaaaaa") && !ids(three).includes("ffffffff"), "not the current face, never a hidden one");
  assert.deepEqual(ids(pickVariantFaces(pack, { count: 9, exclude: ["aaaaaaaa"] })).length, 4, "no more than the pack has");
  assert.deepEqual(ids(pickVariantFaces(pack, { count: 1 })), ["bbbbbbbb"]);
});

test("Try other faces: the design is duplicated per face, each copy gets a locked-down face-swap turn, grouped as a set", async () => {
  const t = await startApp({ conceptConcurrency: 2 });
  const argsFile = path.join(tempDir(), "args.jsonl");
  const trace = path.join(tempDir(), "trace.jsonl");
  try {
    const faces = [["aaaaaaaa", "smile"], ["bbbbbbbb", "shock"], ["cccccccc", "angry"], ["dddddddd", "sad"]];
    for (const [id, expression] of faces) seedFace(t.dataDir, id, { labels: L({ expression }) }, await disc(300, 80));
    const made = await withEnv({ FAKE_CLAUDE_ARGS_OUT: argsFile }, () => designWithFace(t, "aaaaaaaa", { sticker: { displayWidth: 300 }, mirror: true }));
    const sourceVersions = made.project.versions.length;

    assert.equal((await t.api("POST", `/api/projects/${made.id}/face-variants`, { faces: ["deadbeef"] })).body.error.code, "BAD_FACES");
    assert.equal((await t.api("POST", `/api/projects/${made.id}/face-variants`, { count: 9 })).body.error.code, "BAD_COUNT");
    const none = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x" } })).body;
    assert.equal((await t.api("POST", `/api/projects/${none.id}/face-variants`, { count: 2 })).body.error.code, "NO_RENDERS");

    const created = await withEnv({ FAKE_CLAUDE_ARGS_OUT: argsFile, FAKE_CLAUDE_TRACE: trace, FAKE_CLAUDE_DELAY_MS: "700" }, async () => {
      const res = await t.api("POST", `/api/projects/${made.id}/face-variants`, { count: 3 });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.kind, "faces");
      assert.equal(res.body.concepts.length, 3);
      assert.equal(res.body.source.projectId, made.id);
      const set = await until(async () => (await t.api("GET", `/api/concept-sets/${res.body.id}`)).body, (s) => ["done", "failed"].includes(s.state));
      assert.equal(set.state, "done", JSON.stringify(set.concepts.map((c) => c.error)));
      return set;
    });
    // Auto-picked: the three other faces, one expression each.
    assert.deepEqual(created.concepts.map((c) => c.face).sort(), ["bbbbbbbb", "cccccccc", "dddddddd"]);
    assert.ok(created.concepts.every((c) => c.state === "done" && c.renderUrl && c.label.endsWith(" face")));

    // Each copy is its own project holding the new face (mirrored and stickered like the old one) and a design that shows it.
    for (const c of created.concepts) {
      const p = await getProject(t, c.projectId);
      assert.equal(p.conceptSet.id, created.id);
      assert.equal(p.duplicatedFrom, made.id);
      assert.equal(p.starred, false);
      const asset = p.assets.find((a) => a.faceId === c.face);
      assert.equal(asset.name, `face-${c.face}-mirrored-sticker.png`);
      assert.equal(asset.sticker.displayWidth, 300);
      const html = fs.readFileSync(path.join(t.dataDir, "projects", c.projectId, "design.html"), "utf8");
      assert.ok(html.includes(`assets/${asset.name}`), "the design shows the new face");
    }
    // The source is untouched.
    const source = await getProject(t, made.id);
    assert.equal(source.versions.length, sourceVersions);
    assert.equal(source.conceptSet ?? null, null);

    // The turns: one each, locked down to render and use_face, told to change only the face.
    const swaps = readCalls(argsFile).filter((c) => /change only the face/i.test(c.systemPrompt ?? ""));
    assert.equal(swaps.length, 3);
    for (const call of swaps) {
      const allowed = flagOf(call.argv, "--allowedTools").split(",");
      assert.ok(allowed.includes("mcp__imago__render") && allowed.includes("mcp__imago__use_face"));
      for (const banned of ["mcp__imago__find_faces", "mcp__imago__cut_out", "mcp__imago__search_images", "mcp__imago__fetch_image", "Bash", "WebFetch"]) assert.ok(!allowed.includes(banned), banned);
      assert.ok(allowed.includes("Edit(./design.html)"), "writes are granted as Edit rules");
      assert.ok(!flagOf(call.argv, "--tools").includes("WebSearch"));
      assert.match(call.stdin, /Change only the face\. Replace assets\/face-aaaaaaaa-mirrored-sticker\.png with assets\/face-[b-d]{8}-mirrored-sticker\.png/);
      assert.match(call.stdin, /CSS px and subtract [\d.]+px/);
      assert.ok(!/Your concept/.test(call.systemPrompt), "a face swap is not a concept brief");
    }
    // In parallel, under the cap of two.
    let live = 0;
    let peak = 0;
    for (const e of readCalls(trace).sort((a, b) => a.t - b.t).filter((e) => e.cwd !== made.dir)) {
      live += e.event === "start" ? 1 : -1;
      peak = Math.max(peak, live);
    }
    assert.equal(peak, 2);

    // Picking stars the chosen one and leaves the others in the library.
    const pick = created.concepts[1].projectId;
    const picked = await t.api("POST", `/api/concept-sets/${created.id}/pick`, { project: pick });
    assert.equal(picked.body.picked, pick);
    assert.equal((await getProject(t, pick)).starred, true);
    for (const c of created.concepts.filter((x) => x.projectId !== pick)) assert.equal((await getProject(t, c.projectId)).starred, false);
    assert.equal((await t.api("GET", "/api/projects")).body.total, 5, "the others stay in the library");
    assert.equal((await t.api("POST", `/api/concept-sets/${created.id}/pick`, { project: made.id })).body.error.code, "NOT_A_MEMBER");
    assert.equal((await t.api("POST", `/api/concept-sets/${created.id}/another`)).status, 409);
  } finally {
    await t.close();
  }
});

test("Try other faces with chosen faces; a design with no pack face is refused", async () => {
  const t = await startApp();
  try {
    seedFace(t.dataDir, "aaaaaaaa", {}, await disc(300, 80));
    seedFace(t.dataDir, "bbbbbbbb", { labels: L({ expression: "shock" }) }, await disc(300, 80));
    seedFace(t.dataDir, "cccccccc", { hidden: true }, await disc(300, 80));
    const made = await designWithFace(t, "aaaaaaaa");
    assert.equal((await t.api("POST", `/api/projects/${made.id}/face-variants`, { faces: ["cccccccc"] })).body.error.code, "BAD_FACES", "a hidden face is not offered");
    const res = await t.api("POST", `/api/projects/${made.id}/face-variants`, { faces: ["bbbbbbbb"] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.concepts.map((c) => c.face), ["bbbbbbbb"]);
    const set = await until(async () => (await t.api("GET", `/api/concept-sets/${res.body.id}`)).body, (s) => ["done", "failed"].includes(s.state));
    assert.equal(set.state, "done");
    const noFace = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x" } })).body;
    await t.api("POST", `/api/projects/${noFace.id}/messages`, { text: "go" });
    // A version lands before the turn's slot is released; wait for both, or the answer is TURN_RUNNING.
    await until(async () => getProject(t, noFace.id), (p) => p.versions.length >= 1 && !p.running);
    assert.equal((await t.api("POST", `/api/projects/${noFace.id}/face-variants`, { count: 2 })).body.error.code, "NO_FACE");
  } finally {
    await t.close();
  }
});

// ---- 4. title A/B sets ------------------------------------------------------------------------------

test("the title rule: a thumbnail's words never repeat its title", () => {
  assert.equal(repeatsTitle("WE DID IT", "We did it all in 24 hours"), true);
  assert.equal(repeatsTitle("NEVER AGAIN", "I will never do this again"), true);
  assert.equal(repeatsTitle("PLOT TWIST", "How I built the game"), false);
  assert.equal(repeatsTitle("THE END", "The game"), false, "a stop word alone is not a repeat, 'end' is new");
  assert.equal(repeatsTitle("", "Anything"), false);
  const assets = new Set();
  const c = (over) => ({ archetype: "reaction", label: "L", idea: "i", text: "PLOT TWIST", why: "w", title: "How I built it", ...over });
  const titles = ["How I built it", "Why it failed"];
  const ok = validateConcepts({ concepts: [c(), c({ archetype: "number", title: "why it  FAILED", text: "AND THEN" })] }, { count: 2, assets, titles });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.concepts.map((x) => x.title), titles, "the exact listed title is kept");
  assert.match(validateConcepts({ concepts: [c({ text: "BUILT IT" }), c({ archetype: "number", title: "Why it failed" })] }, { count: 2, assets, titles }).reason, /repeats its title/);
  assert.match(validateConcepts({ concepts: [c(), c({ archetype: "number", title: "Something else" })] }, { count: 2, assets, titles }).reason, /title must be exactly/);
  assert.match(validateConcepts({ concepts: [c({ title: undefined }), c({ archetype: "number", title: "Why it failed" })] }, { count: 2, assets, titles }).reason, /title must be exactly/);
});

const TITLES = ["How I built the game", "Why the launch failed"];

test("a title A/B set: one concept per title, planned and designed for that title, exported under its name", async () => {
  const t = await startApp();
  const argsFile = path.join(tempDir(), "args.jsonl");
  try {
    for (const bad of [{ titles: ["Only one"] }, { titles: ["a", "b", "c", "d"] }, { titles: ["Same", "same"] }, { titles: ["a", ""] }, { titles: "no" }, { titles: TITLES, count: 3 }]) {
      assert.equal((await t.api("POST", "/api/concept-sets", { ...bad, brief: {} })).status, 400, JSON.stringify(bad));
    }
    const draft = (await t.api("POST", "/api/concept-sets", { titles: TITLES, brief: {} })).body;
    assert.equal(draft.state, "draft");
    assert.deepEqual(draft.titles, TITLES);
    assert.deepEqual(draft.concepts.map((c) => c.forTitle), TITLES);
    assert.equal(draft.title, TITLES.join(" / "));
    const projects = await Promise.all(draft.concepts.map(async (c) => getProject(t, c.projectId)));
    assert.deepEqual(projects.map((p) => p.brief.title), TITLES, "each project's brief carries its own title");
    assert.deepEqual(projects.map((p) => p.title), TITLES);

    const set = await withEnv({ FAKE_CLAUDE_ARGS_OUT: argsFile }, async () => {
      await t.api("POST", `/api/concept-sets/${draft.id}/start`);
      return until(async () => (await t.api("GET", `/api/concept-sets/${draft.id}`)).body, (s) => ["done", "failed"].includes(s.state));
    });
    assert.equal(set.state, "done");
    assert.equal(set.plan.source, "planner", set.plan.note);
    assert.deepEqual(set.concepts.map((c) => c.text), ["AND THEN", "PLOT TWIST"]);
    const calls = readCalls(argsFile);
    const planner = calls.find((c) => /concept planner/.test(c.systemPrompt));
    assert.match(planner.systemPrompt, /## Title A\/B test/);
    assert.match(planner.systemPrompt, /never repeats its title/);
    assert.match(planner.systemPrompt, /1\. How I built the game\n2\. Why the launch failed/);
    assert.match(planner.stdin, /title A\/B test of 2 titles: 1\. "How I built the game"; 2\. "Why the launch failed"/);
    const designs = calls.filter((c) => /Your concept/.test(c.systemPrompt ?? ""));
    assert.equal(designs.length, 2);
    for (const [i, title] of TITLES.entries()) {
      const mine = designs.find((c) => c.stdin.includes(`Make concept ${i + 1} of 2`));
      assert.ok(mine.systemPrompt.includes(`Its title (an A/B test: this thumbnail runs beside it, so the words on the image must never repeat or rephrase it): ${JSON.stringify(title)}`), `concept ${i + 1} is told its title`);
      assert.ok(mine.stdin.includes(`Video title or topic: ${title}`), "and its brief carries it");
    }
    assert.deepEqual((await Promise.all(set.concepts.map((c) => getProject(t, c.projectId)))).map((p) => p.title), TITLES, "the title stays the project's name");
    assert.equal((await t.api("POST", `/api/concept-sets/${draft.id}/another`)).status, 409);

    // Test & Compare names each file after its title.
    const exported = (await t.api("POST", `/api/concept-sets/${draft.id}/test-compare`, {})).body;
    assert.deepEqual(exported.files.map((f) => f.name), ["thumbnail-1-How-I-built-the-game.jpg", "thumbnail-2-Why-the-launch-failed.jpg"]);
    const zip = await fetch(t.base + exported.url);
    assert.equal(zip.status, 200);
    const buf = Buffer.from(await zip.arrayBuffer());
    const names = [];
    for (let at = 0; buf.readUInt32LE(at) === 0x04034b50;) {
      const size = buf.readUInt32LE(at + 18);
      const nameLen = buf.readUInt16LE(at + 26);
      names.push(buf.toString("ascii", at + 30, at + 30 + nameLen));
      at += 30 + nameLen + size;
    }
    assert.deepEqual(names, ["thumbnail-1-How-I-built-the-game.jpg", "thumbnail-2-Why-the-launch-failed.jpg", "titles.txt"]);
  } finally {
    await t.close();
  }
});

test("a planner that repeats a title in its words, or leaves the title out, falls back with the titles kept", async () => {
  const t = await startApp();
  try {
    for (const mode of ["repeat", "notitle"]) {
      await withEnv({ FAKE_CLAUDE_PLANNER: mode }, async () => {
        const draft = (await t.api("POST", "/api/concept-sets", { titles: TITLES, brief: {} })).body;
        await t.api("POST", `/api/concept-sets/${draft.id}/start`);
        const set = await until(async () => (await t.api("GET", `/api/concept-sets/${draft.id}`)).body, (s) => ["done", "failed"].includes(s.state));
        assert.equal(set.plan.source, "fallback", mode);
        assert.match(set.plan.note, mode === "repeat" ? /repeats its title/ : /title must be exactly/);
        assert.deepEqual(set.concepts.map((c) => c.forTitle), TITLES);
        assert.equal(set.state, "done");
      });
    }
  } finally {
    await t.close();
  }
});

// ---- 5. exports ------------------------------------------------------------------------------------------

test("Export writes the 3x JPG into the project under its title, lists it, and a second export overwrites rather than piles up", async () => {
  const t = await startApp();
  try {
    const p = (await t.api("POST", "/api/projects", { preset: "thumbnail", title: "My Big Title!", brief: { title: "My Big Title!" } })).body;
    assert.equal((await t.api("POST", `/api/projects/${p.id}/quick-export`)).body.error.code, "NO_RENDERS");
    await t.api("POST", `/api/projects/${p.id}/messages`, { text: "go" });
    await until(async () => (await getProject(t, p.id)).versions.length, (n) => n >= 1);
    await until(async () => (await getProject(t, p.id)).running, (r) => !r);
    assert.deepEqual((await t.api("GET", `/api/projects/${p.id}/exports`)).body, { items: [] });

    const done = await t.api("POST", `/api/projects/${p.id}/quick-export`);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.name, "My-Big-Title-v1.jpg");
    assert.deepEqual([done.body.width, done.body.height], [3840, 2160]);
    assert.ok(done.body.bytes < 1_990_000 && done.body.overBudget === false);
    const file = path.join(t.dataDir, "projects", p.id, "exports", done.body.name);
    assert.ok(fs.existsSync(file));
    assert.equal((await sharp(file).metadata()).format, "jpeg");
    const served = await fetch(t.base + done.body.url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/jpeg");

    await t.api("POST", `/api/projects/${p.id}/quick-export`);
    const listed = (await t.api("GET", `/api/projects/${p.id}/exports`)).body.items;
    assert.equal(listed.length, 1, "exporting again replaces the file");
    assert.deepEqual([listed[0].name, listed[0].kind], ["My-Big-Title-v1.jpg", "image"]);
    assert.ok(listed[0].bytes > 0 && listed[0].url === done.body.url && Date.parse(listed[0].at) > 0);

    // Other finished files in the folder show up too (a zip as a zip); stray files do not.
    fs.writeFileSync(path.join(t.dataDir, "projects", p.id, "exports", `${p.id}-v1-covers.zip`), "zip");
    fs.writeFileSync(path.join(t.dataDir, "projects", p.id, "exports", "notes.txt"), "x");
    assert.deepEqual((await t.api("GET", `/api/projects/${p.id}/exports`)).body.items.map((i) => i.kind).sort(), ["image", "zip"]);

    assert.equal((await t.api("DELETE", `/api/projects/${p.id}/exports/${done.body.name}`)).status, 200);
    assert.equal((await t.api("DELETE", `/api/projects/${p.id}/exports/${done.body.name}`)).status, 404);
    assert.equal((await t.api("DELETE", `/api/projects/${p.id}/exports/notes.txt`)).status, 400, "only export files can be removed");
    assert.equal((await t.api("DELETE", `/api/projects/${p.id}/exports/..%2Fproject.json`)).status, 400);
    assert.ok(fs.existsSync(path.join(t.dataDir, "projects", p.id, "project.json")));
    assert.equal((await t.api("GET", `/api/projects/${p.id}/exports`)).body.items.length, 1);
  } finally {
    await t.close();
  }
});
