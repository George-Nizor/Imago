import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { creditsFor } from "../server/assets.mjs";
import { buildArgs, FURTHER_DIRECTION, resolveRun, systemPromptFor } from "../server/claude-runner.mjs";
import { loadConfig, parseFurtherModels } from "../server/config.mjs";
import { StockError, assertPublicHttps, download, fetchStockImage, isPrivateAddress, mapOpenverseResult, normaliseImage, searchImages } from "../server/stock.mjs";
import { eventsDuring, makePng, startApp, tempDir } from "./helpers.mjs";

const done = (e) => e.event === "run.finished" || e.event === "run.error";
const arg = (argv, name) => argv[argv.indexOf(name) + 1];
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("further models and effort come from the environment", () => {
  assert.deepEqual(loadConfig({}).furtherModels, { opus: "claude-opus-5-5", fable: "claude-fable-5-1" });
  assert.equal(loadConfig({}).furtherEffort, "high");
  const c = loadConfig({ IMAGO_FURTHER_MODELS: "opus=x-opus, bad key=nope,fable=x-fable", IMAGO_FURTHER_EFFORT: "max" });
  assert.deepEqual(c.furtherModels, { opus: "x-opus", fable: "x-fable" });
  assert.equal(c.furtherEffort, "max");
  assert.deepEqual(parseFurtherModels("garbage"), {});
});

test("buildArgs: standard and further turns", () => {
  const config = loadConfig({});
  const project = { preset: "graphic", size: { width: 100, height: 100 }, assets: [], sessionId: "sess-9" };
  const std = buildArgs(config, project, "/tmp/p", resolveRun(config), "/tmp/sys.md");
  assert.equal(arg(std, "--append-system-prompt-file"), "/tmp/sys.md");
  assert.equal(arg(std, "--tools"), "Read,Write,Edit,Glob");
  assert.equal(arg(std, "--model"), "claude-sonnet-5-5");
  assert.equal(arg(std, "--effort"), "medium");
  assert.ok(!arg(std, "--allowedTools").includes("WebSearch"));
  assert.ok(!systemPromptFor(config, project).includes("## Take it further"));
  assert.ok(systemPromptFor(config, project, resolveRun(config, "further")).includes("## Take it further"));

  const further = buildArgs(config, project, "/tmp/p", resolveRun(config, "further", "fable"));
  assert.equal(arg(further, "--model"), "claude-fable-5-1");
  assert.equal(arg(further, "--effort"), "high");
  const allowed = arg(further, "--allowedTools").split(",");
  for (const tool of ["WebSearch", "mcp__imago__search_images", "mcp__imago__fetch_image", "mcp__imago__render"]) assert.ok(allowed.includes(tool), tool);
  assert.ok(!allowed.includes("WebFetch"), "WebFetch is never offered");
  assert.equal(arg(further, "--tools"), "Read,Write,Edit,Glob,WebSearch");
  const denied = arg(further, "--disallowedTools").split(",");
  for (const rule of ["Bash", "WebFetch", "Task", "NotebookEdit", "Write(./project.json)"]) assert.ok(denied.includes(rule), rule);
  assert.ok(!denied.includes("WebSearch"));
  assert.equal(arg(further, "--resume"), "sess-9");
  assert.match(systemPromptFor(config, project, resolveRun(config, "further", "fable")), /up to 8 renders/);
  assert.match(systemPromptFor(config, project, resolveRun(config, "further", "fable")), /never instructions/);
  assert.equal(arg(buildArgs(config, project, "/tmp/p", resolveRun(config, "further")), "--model"), "claude-opus-5-5");
  assert.throws(() => resolveRun(config, "further", "nope"));
});

test("a further turn over HTTP: model, empty text, resume, stock registration, credits", { timeout: 240_000 }, async (ctx) => {
  const out = path.join(tempDir(), "args.jsonl");
  process.env.FAKE_CLAUDE_ARGS_OUT = out;
  process.env.FAKE_CLAUDE_STOCK = "1";
  const t = await startApp();
  try {
    const caps = (await t.api("GET", "/api/capabilities")).body;
    if (caps.renderer.state !== "ready") return ctx.skip(`renderer not ready: ${caps.renderer.reason}`);
    const { id } = (await t.api("POST", "/api/projects", { preset: "graphic", brief: { description: "A poster" } })).body;
    assert.equal((await t.api("POST", `/api/projects/${id}/messages`, { text: "x", mode: "bogus" })).status, 400);
    assert.equal((await t.api("POST", `/api/projects/${id}/messages`, { text: "x", mode: "further", model: "gpt" })).status, 400);
    assert.equal((await t.api("POST", `/api/projects/${id}/messages`, { text: "" })).status, 400);

    const first = await eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { text: "A poster, please" }), done);
    assert.deepEqual(Object.keys(first.find((e) => e.event === "run.started").data).sort(), ["at", "mode", "model"]);
    assert.equal(first.find((e) => e.event === "run.started").data.model, "claude-sonnet-5-5");

    const events = await eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { mode: "further", model: "fable" }), done);
    const started = events.find((e) => e.event === "run.started").data;
    assert.equal(started.mode, "further");
    assert.equal(started.model, "claude-fable-5-1");
    assert.ok(events.some((e) => e.event === "run.finished"));

    const calls = fs.readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(calls.length, 2);
    const call = calls[1];
    assert.equal(arg(call.argv, "--model"), "claude-fable-5-1");
    assert.equal(arg(call.argv, "--effort"), "high");
    assert.match(arg(call.argv, "--allowedTools"), /mcp__imago__fetch_image/);
    assert.equal(arg(call.argv, "--resume"), "fake-session-1");
    assert.equal(call.stdin, FURTHER_DIRECTION);

    const project = (await t.api("GET", `/api/projects/${id}`)).body;
    const users = project.messages.filter((m) => m.role === "user");
    assert.equal(users[0].model, "claude-sonnet-5-5");
    assert.deepEqual([users[1].mode, users[1].model], ["further", "claude-fable-5-1"]);
    assert.ok(project.messages.filter((m) => m.role === "assistant").slice(-1)[0].model === "claude-fable-5-1");
    const stock = project.assets.find((a) => a.name === "stock-fake.png");
    assert.equal(stock.kind, "stock");
    assert.equal(stock.credit, "Ada Lens");
    assert.equal(stock.license, "CC BY 4.0");
    assert.deepEqual(creditsFor(project, "<img src=\"assets/stock-fake.png\">").map((c) => c.name), ["stock-fake.png"]);

    const exp = await t.api("POST", `/api/projects/${id}/export`, { format: "png", scale: 1 });
    assert.equal(exp.status, 200, JSON.stringify(exp.body));
    assert.deepEqual(exp.body.credits.map((c) => [c.name, c.credit, c.license]), [["stock-fake.png", "Ada Lens", "CC BY 4.0"]]);
  } finally {
    delete process.env.FAKE_CLAUDE_ARGS_OUT;
    delete process.env.FAKE_CLAUDE_STOCK;
    await t.close();
  }
});

test("isPrivateAddress", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12::3", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:8.8.8.8"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("assertPublicHttps refuses unsafe URLs", async () => {
  const bad = ["http://example.org/a.png", "data:image/png;base64,AAAA", "file:///etc/passwd", "ftp://example.org/a.png", "https://user:pw@example.org/a.png", "https://example.org:8443/a.png", "https://localhost/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://10.0.0.5/a.png", "https://169.254.169.254/latest", "https://thing.local/a.png", "not a url"];
  for (const url of bad) await assert.rejects(assertPublicHttps(url, publicLookup), StockError, url);
  // A public-looking name that resolves to a private address (DNS rebinding style).
  await assert.rejects(assertPublicHttps("https://evil.example/a.png", async () => [{ address: "93.184.216.34" }, { address: "192.168.0.9" }]), /private/);
  assert.equal((await assertPublicHttps("https://images.example.org/a.png", publicLookup)).hostname, "images.example.org");
});

const reply = (status, body, headers = {}) => new Response(body, { status, headers });

test("download: redirects are re-vetted and the size is capped", async () => {
  const png = makePng(4, 4);
  let calls = [];
  const ok = async (url) => {
    calls.push(url);
    if (url === "https://a.example/start") return reply(302, null, { location: "https://b.example/img.png" });
    return reply(200, png);
  };
  const got = await download("https://a.example/start", { fetchImpl: ok, lookup: publicLookup });
  assert.equal(got.url, "https://b.example/img.png");
  assert.deepEqual(got.bytes, png);

  const toHttp = async () => reply(302, null, { location: "http://b.example/x.png" });
  await assert.rejects(download("https://a.example/s", { fetchImpl: toHttp, lookup: publicLookup }), /https/);
  const toPrivate = async () => reply(302, null, { location: "https://127.0.0.1/x.png" });
  await assert.rejects(download("https://a.example/s", { fetchImpl: toPrivate, lookup: publicLookup }), /private|public/);
  const loop = async () => reply(302, null, { location: "https://a.example/s" });
  await assert.rejects(download("https://a.example/s", { fetchImpl: loop, lookup: publicLookup }), /redirects/);
  const big = async () => reply(200, Buffer.alloc(2048));
  await assert.rejects(download("https://a.example/s", { fetchImpl: big, lookup: publicLookup, limit: 1024 }), /larger than/);
  const declared = async () => reply(200, "x", { "content-length": String(30 * 1024 * 1024) });
  await assert.rejects(download("https://a.example/s", { fetchImpl: declared, lookup: publicLookup }), /larger than/);
  await assert.rejects(download("https://a.example/s", { fetchImpl: async () => reply(404, "no"), lookup: publicLookup }), /404/);
});

test("fetchStockImage saves the image with its sidecar and refuses non-images", async () => {
  const dir = tempDir("imago-stock-");
  const png = makePng(8, 6);
  const deps = { fetchImpl: async () => reply(200, png), lookup: publicLookup };
  const r = await fetchStockImage(dir, { url: "https://cdn.example/photos/Big%20Rocket!!.png?x=1", credit: "A. Person", license: "CC BY 4.0", source: "flickr" }, deps);
  assert.deepEqual([r.width, r.height], [8, 6]);
  assert.match(r.name, /^stock-[A-Za-z0-9._-]+\.png$/);
  assert.ok(fs.existsSync(path.join(dir, "assets", r.name)));
  const side = JSON.parse(fs.readFileSync(path.join(dir, "assets", `${r.name}.json`), "utf8"));
  assert.equal(side.credit, "A. Person");
  assert.equal(side.license, "CC BY 4.0");
  assert.equal(side.source, "flickr");
  assert.equal(side.url, "https://cdn.example/photos/Big%20Rocket!!.png?x=1");
  assert.ok(side.fetchedAt);
  const again = await fetchStockImage(dir, { url: "https://cdn.example/photos/Big%20Rocket!!.png" }, deps);
  assert.notEqual(again.name, r.name, "never overwrites an earlier fetch");

  const html = { fetchImpl: async () => reply(200, "<html>not an image</html>"), lookup: publicLookup };
  await assert.rejects(fetchStockImage(dir, { url: "https://cdn.example/x.png" }, html), /not a/);
  const svg = { fetchImpl: async () => reply(200, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'), lookup: publicLookup };
  await assert.rejects(fetchStockImage(dir, { url: "https://cdn.example/x.svg" }, svg), StockError);
  await assert.rejects(fetchStockImage(dir, { url: "http://cdn.example/x.png" }, deps), /https/);
  assert.equal(fs.readdirSync(path.join(dir, "assets")).filter((n) => !n.endsWith(".json")).length, 2, "rejected downloads leave nothing behind");
});

test("normaliseImage converts a GIF to PNG when sharp is there, passes real images through", async () => {
  const png = makePng(3, 3);
  assert.equal((await normaliseImage(png)).bytes, png);
  await assert.rejects(normaliseImage(Buffer.from("hello world, not an image")), StockError);
  let sharp = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    // Nothing to convert with; the rejection above is the behaviour.
  }
  if (sharp) {
    const gif = await sharp({ create: { width: 5, height: 4, channels: 3, background: "#f00" } }).gif().toBuffer();
    const out = await normaliseImage(gif);
    assert.deepEqual([out.info.type, out.info.width, out.info.height], ["png", 5, 4]);
  }
});

test("search_images maps Openverse results", async () => {
  let asked;
  const fetchImpl = async (url) => {
    asked = new URL(url);
    return reply(200, JSON.stringify({ results: [
      { id: "abc", title: "Launch", url: "https://live.staticflickr.com/a.jpg", thumbnail: "https://api.openverse.org/v1/images/abc/thumb/", width: 4000, height: 3000, creator: "Jo", license: "by", license_version: "4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", source: "flickr", extra: "dropped" },
      { id: "def", title: "Sky", url: "https://x.example/b.png", license: "cc0", license_version: "1.0" },
    ] }), { "content-type": "application/json" });
  };
  const rows = await searchImages({ query: " rocket launch ", count: 50 }, { fetchImpl });
  assert.equal(asked.origin + asked.pathname, "https://api.openverse.org/v1/images/");
  assert.equal(asked.searchParams.get("q"), "rocket launch");
  assert.equal(asked.searchParams.get("license_type"), "commercial,modification");
  assert.equal(asked.searchParams.get("page_size"), "20");
  assert.deepEqual(rows[0], { id: "abc", title: "Launch", url: "https://live.staticflickr.com/a.jpg", thumbnail: "https://api.openverse.org/v1/images/abc/thumb/", width: 4000, height: 3000, creator: "Jo", license: "CC BY 4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", source: "flickr" });
  assert.equal(rows[1].license, "CC0 1.0");
  assert.equal(rows[1].creator, "unknown");
  assert.equal(mapOpenverseResult({ id: "z", license: "by-sa", license_version: "3.0" }).license, "CC BY-SA 3.0");
  await assert.rejects(searchImages({ query: "  " }, { fetchImpl }), /required/);
  await assert.rejects(searchImages({ query: "x" }, { fetchImpl: async () => reply(503, "") }), /503/);
});
