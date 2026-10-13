import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LOCAL_CHROMIUM_LIBS, loadConfig } from "../server/config.mjs";
import { mcpConfig } from "../server/claude-runner.mjs";
import { eventsDuring, makePng, seedProject, startApp, tempDir } from "./helpers.mjs";

const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

async function renderThrough(project, design, { assets = {}, neighbours = [] } = {}) {
  const dataDir = tempDir();
  const projectsDir = path.join(dataDir, "projects");
  for (const id of neighbours) seedProject(projectsDir, id);
  const dir = path.join(projectsDir, project.id);
  for (const sub of ["assets", "versions", "renders"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  fs.writeFileSync(path.join(dir, "design.html"), design);
  for (const [name, bytes] of Object.entries(assets)) fs.writeFileSync(path.join(dir, "assets", name), bytes);
  const env = { ...process.env };
  if (!env.IMAGO_CHROMIUM_LIBS && fs.existsSync(LOCAL_CHROMIUM_LIBS)) env.IMAGO_CHROMIUM_LIBS = LOCAL_CHROMIUM_LIBS;
  const config = loadConfig(env, { dataDir });
  const mcp = mcpConfig(config, project, dir).mcpServers.imago;
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: mcp.command, args: mcp.args, env: { ...env, ...mcp.env } }));
  try {
    return { dir, result: await client.callTool({ name: "render", arguments: {} }), env: mcp.env };
  } finally {
    await client.close();
  }
}

const page = (w, h) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fonts/fonts.css"><style>
html,body{margin:0}body{width:${w}px;height:${h}px;overflow:hidden;position:relative;background:#101820;font-family:"Anton",sans-serif}
h1{position:absolute;left:40px;top:60px;margin:0;color:#fff;font-size:150px;line-height:1}
.tiny{position:absolute;left:40px;top:400px;color:#fff;font:400 18px Inter,sans-serif}
.hidden{display:none}img{position:absolute;right:0;bottom:0;height:80%}
</style></head><body><h1>LAUNCH DAY</h1><p class="tiny">six more small words go here</p><p class="hidden">invisible words that do not count</p><img src="assets/face-cutout.png" alt=""></body></html>`;

test("render returns the design, a feed mock-up and checks, and saves the mock-up", { timeout: 120_000 }, async (ctx) => {
  const project = { id: "me-aaaa", preset: "thumbnail", title: "Rockets are cool", size: { width: 1280, height: 720 }, brief: { title: "Rockets are cool", format: "video" } };
  let out;
  try {
    out = await renderThrough(project, page(1280, 720), { assets: { "face-cutout.png": makePng(300, 600, [200, 150, 120]) }, neighbours: ["one-bbbb", "two-cccc"] });
  } catch (error) {
    if (/Electron|renderer/i.test(String(error))) return ctx.skip(String(error));
    throw error;
  }
  const { dir, result } = out;
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.deepEqual(result.content.map((c) => c.type), ["image", "image", "text"]);
  const [design, feed] = result.content.map((c) => c.data && Buffer.from(c.data, "base64"));
  assert.deepEqual(pngSize(design), { width: 1280, height: 720 });
  assert.equal(pngSize(feed).width, 1568);
  assert.ok(pngSize(feed).height > 1000);
  assert.ok(fs.readFileSync(path.join(dir, "renders", "v1-feed.png")).equals(feed));
  assert.ok(fs.existsSync(path.join(dir, "renders", "v1.png")));
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith("imago-feed")), []);

  const reply = JSON.parse(result.content[2].text);
  assert.equal(reply.version, 1);
  assert.deepEqual(reply.warnings, []);
  const by = Object.fromEntries(reply.checks.map((c) => [c.id, c]));
  assert.deepEqual(reply.checks.map((c) => c.id), ["text.words", "text.repeatsTitle", "text.smallest", "text.contrast", "layout.badge", "subject.size", "image.contrast", "image.colourfulness", "feed.distinct"]);
  assert.equal(by["text.words"].value, 8, "display:none text is not counted");
  assert.equal(by["text.words"].level, "warn");
  assert.equal(by["text.smallest"].level, "warn", "an 18px line is unreadable at 168 px wide");
  assert.equal(by["text.contrast"].level, "ok");
  assert.equal(by["subject.size"].value, 0.8);
  assert.equal(by["layout.badge"].level, "warn", "the cut-out reaches the badge zone");
  assert.match(by["feed.distinct"].message, /your other thumbnails/);
});

test("a 9:16 render checks the safe zones, and falls back to stand-ins without neighbours", { timeout: 120_000 }, async (ctx) => {
  const project = { id: "tall-aaaa", preset: "thumbnail", title: "Tall", size: { width: 720, height: 1280 }, brief: { title: "Tall", format: "shorts" } };
  const design = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fonts/fonts.css"><style>html,body{margin:0}body{width:720px;height:1280px;overflow:hidden;background:#222;position:relative}h1{position:absolute;left:40px;top:20px;margin:0;font:400 120px Anton;color:#fff}</style></head><body><h1>TOP</h1></body></html>`;
  let out;
  try {
    out = await renderThrough(project, design);
  } catch (error) {
    if (/Electron|renderer/i.test(String(error))) return ctx.skip(String(error));
    throw error;
  }
  assert.deepEqual(out.result.content.map((c) => c.type), ["image", "image", "text"]);
  const by = Object.fromEntries(JSON.parse(out.result.content[2].text).checks.map((c) => [c.id, c]));
  assert.equal(by["layout.safe"].level, "warn");
  assert.equal("layout.badge" in by, false);
  assert.match(by["feed.distinct"].message, /stand-in/);
});

test("photo projects are rendered as before: one image, no checks", { timeout: 120_000 }, async (ctx) => {
  const project = { id: "photo-aaaa", preset: "photo", title: "Photo", size: { width: 640, height: 360 }, brief: {} };
  let out;
  try {
    out = await renderThrough(project, page(640, 360));
  } catch (error) {
    if (/Electron|renderer/i.test(String(error))) return ctx.skip(String(error));
    throw error;
  }
  assert.deepEqual(out.result.content.map((c) => c.type), ["image", "text"]);
  assert.equal("checks" in JSON.parse(out.result.content[1].text), false);
});

test("a turn records the checks on the version and announces the feed mock-up", { timeout: 120_000 }, async (ctx) => {
  const t = await startApp();
  try {
    if ((await t.api("GET", "/api/capabilities")).body.renderer.state !== "ready") return ctx.skip("renderer not ready");
    const id = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "Rockets are cool" } })).body.id;
    const events = await eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { text: "go" }), (e) => e.event === "run.finished" || e.event === "run.error");
    const done = events.find((e) => e.event === "render.done").data;
    assert.equal(done.feedUrl, `/projects/${id}/renders/v1-feed.png`);
    assert.ok(done.checks.some((c) => c.id === "text.words"));
    const project = (await t.api("GET", `/api/projects/${id}`)).body;
    assert.deepEqual(project.versions[0].checks, done.checks);
    const served = await fetch(t.base + done.feedUrl);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
  } finally {
    await t.close();
  }
});
