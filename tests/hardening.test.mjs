// Security hardening and turn-robustness regressions (see docs/redesign-contract.md).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { writeUnique } from "../server/assets.mjs";
import { renderHtml } from "../server/renderer.mjs";
import { httpUrlOnly, mapOpenverseResult, normaliseImage } from "../server/stock.mjs";
import { buildRecoveryPrompt } from "../server/claude-runner.mjs";
import { eventsDuring, makePng, startApp, tempDir } from "./helpers.mjs";

const done = (e) => e.event === "run.finished" || e.event === "run.error";
const upload = (t, id, name, body, headers = {}) => fetch(`${t.base}/api/projects/${id}/assets`, { method: "POST", headers: { "x-filename": name, ...headers }, body });
const create = async (t, preset = "graphic") => (await t.api("POST", "/api/projects", { preset, brief: { description: "A poster", title: "Rockets" } })).body;
const rendererReady = async (t) => (await t.api("GET", "/api/capabilities")).body.renderer.state === "ready";
async function withMode(mode, fn) {
  const previous = process.env.FAKE_CLAUDE_MODE;
  if (mode) process.env.FAKE_CLAUDE_MODE = mode;
  else delete process.env.FAKE_CLAUDE_MODE;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.FAKE_CLAUDE_MODE;
    else process.env.FAKE_CLAUDE_MODE = previous;
  }
}
/** A PNG whose header claims `width` x `height` (the image data is not real; only the header is read). */
function hugePng(width, height) {
  const png = Buffer.from(makePng(1, 1));
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

// ---- S2: origin -------------------------------------------------------------------------------

test("changing requests need this server's own origin, JSON, and no cross-site fetch metadata", async () => {
  const t = await startApp();
  try {
    const port = new URL(t.base).port;
    const post = (headers, body = JSON.stringify({ preset: "graphic", brief: { description: "x" } }), type = "application/json") =>
      fetch(`${t.base}/api/projects`, { method: "POST", headers: { ...(type ? { "content-type": type } : {}), ...headers }, body });
    assert.equal((await post({})).status, 201, "no Origin: curl, tests");
    assert.equal((await post({ origin: `http://127.0.0.1:${port}` })).status, 201);
    assert.equal((await post({ origin: `http://localhost:${port}` })).status, 201);
    for (const origin of ["http://127.0.0.1:1", `http://127.0.0.1:${Number(port) + 1}`, "http://localhost:5173", "https://evil.example", "null", `http://[::1]:${port}`]) {
      const res = await post({ origin });
      assert.equal(res.status, 403, origin);
      assert.equal((await res.json()).error.code, "FORBIDDEN_ORIGIN");
    }
    assert.equal((await post({ "sec-fetch-site": "same-origin" })).status, 201);
    assert.equal((await post({ "sec-fetch-site": "none" })).status, 201);
    for (const site of ["cross-site", "same-site"]) assert.equal((await post({ "sec-fetch-site": site })).status, 403, site);
    assert.equal((await post({}, "{}", "text/plain")).status, 415);
    assert.equal((await post({}, "{}", "application/x-www-form-urlencoded")).status, 415);
    assert.equal((await post({}, "{}", "application/json; charset=utf-8")).status, 400, "JSON with a charset is fine (then fails on the preset)");
    // Reads are not restricted by Origin.
    assert.equal((await fetch(`${t.base}/api/projects`, { headers: { origin: "https://evil.example" } })).status, 200);

    const { id } = await create(t);
    assert.equal((await upload(t, id, "a.png", makePng(4, 4), { origin: "https://evil.example" })).status, 403);
    const noName = await fetch(`${t.base}/api/projects/${id}/assets`, { method: "POST", body: makePng(4, 4) });
    assert.equal(noName.status, 400);
    assert.equal((await upload(t, id, "a.png", makePng(4, 4), { "content-type": "text/plain" })).status, 415);
    assert.equal((await upload(t, id, "a.png", makePng(4, 4), { "content-type": "multipart/form-data; boundary=x" })).status, 415);
    assert.equal((await upload(t, id, "a.png", makePng(4, 4), { "content-type": "image/png" })).status, 201);
    assert.equal((await upload(t, id, "b.png", makePng(4, 4), { "content-type": "application/octet-stream" })).status, 201);
  } finally {
    await t.close();
  }
});

test("IMAGO_ALLOWED_ORIGINS adds the dev server's origin", async () => {
  const t = await startApp({ allowedOrigins: ["http://localhost:5173"] });
  try {
    const res = await fetch(`${t.base}/api/projects`, { method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ preset: "graphic", brief: { description: "x" } }) });
    assert.equal(res.status, 201);
  } finally {
    await t.close();
  }
});

// ---- S3: project files ------------------------------------------------------------------------

test("project files: images only, inert CSP everywhere", async () => {
  const t = await startApp();
  try {
    const { id } = await create(t);
    const dir = path.join(t.dataDir, "projects", id);
    assert.equal((await upload(t, id, "pic.png", makePng(4, 4))).status, 201);
    for (const [area, name, body] of [["assets", "evil.html", "<script>1</script>"], ["assets", "evil.svg", "<svg/>"], ["assets", "pic.png.json", "{}"], ["renders", "x.txt", "x"], ["exports", "x.html", "<p>"]]) {
      fs.writeFileSync(path.join(dir, area, name), body);
      assert.equal((await fetch(`${t.base}/projects/${id}/${area}/${name}`)).status, 404, `${area}/${name}`);
    }
    for (const [area, name] of [["renders", "v1.jpg"], ["exports", "e.webp"], ["assets", "z.jpeg"]]) {
      fs.writeFileSync(path.join(dir, area, name), makePng(2, 2));
      const res = await fetch(`${t.base}/projects/${id}/${area}/${name}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    }
    const png = await fetch(`${t.base}/projects/${id}/assets/pic.png`);
    assert.equal(png.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    assert.equal(png.headers.get("content-type"), "image/png");
    // design.html and snapshots keep their own policy, now sandboxed too.
    fs.writeFileSync(path.join(dir, "design.html"), "<html></html>");
    fs.writeFileSync(path.join(dir, "versions", "v1.html"), "<html><head></head></html>");
    for (const url of ["design.html", "versions/v1.html"]) {
      const csp = (await fetch(`${t.base}/projects/${id}/${url}`)).headers.get("content-security-policy");
      assert.match(csp, /^sandbox; default-src 'none'; img-src 'self' data:/);
      assert.match(csp, /font-src 'self'/);
    }
    // syncAssets only registers images: a stray svg or html file in assets/ stays out of project.json.
    const { syncAssets } = await import("../server/assets.mjs");
    fs.writeFileSync(path.join(dir, "assets", "other.png"), makePng(3, 3));
    const fresh = await syncAssets(t.app.store, id);
    assert.deepEqual(fresh.map((a) => a.name).sort(), ["other.png", "z.jpeg"].sort());
    assert.ok(!(await t.api("GET", `/api/projects/${id}`)).body.assets.some((a) => /\.(html|svg|json|txt)$/.test(a.name)));
  } finally {
    await t.close();
  }
});

// ---- S5: validator ----------------------------------------------------------------------------

test("fonts are readable from the sandboxed preview (cross-origin) and designs keep working", async () => {
  const t = await startApp();
  try {
    const res = await fetch(`${t.base}/fonts/Anton.ttf`, { headers: { origin: "null" } });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  } finally {
    await t.close();
  }
});

test("a script the validator would miss still cannot run in the renderer (CSP has no script-src)", { timeout: 120_000 }, async (ctx) => {
  const t = await startApp();
  try {
    if (!(await rendererReady(t))) return ctx.skip("renderer not ready");
    let sharp;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      return ctx.skip("sharp not installed");
    }
    const dir = tempDir("imago-csp-");
    const html = `<!doctype html><html><head><style>html,body{margin:0}body{width:64px;height:64px;background:#ff0000;overflow:hidden}</style></head><body>
<script>document.body.style.background="#0000ff"</script><script/x>document.body.style.background="#0000ff"</script></body></html>`;
    fs.writeFileSync(path.join(dir, "design.html"), html);
    const out = path.join(dir, "out.png");
    await renderHtml(t.config, { htmlFile: path.join(dir, "design.html"), width: 64, height: 64, out });
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 200 && data[1] < 40 && data[2] < 40, `expected red, got ${[...data.slice(0, 3)]}`);
  } finally {
    await t.close();
  }
});

// ---- S7 / S9 ----------------------------------------------------------------------------------

test("licence links are http(s) only", () => {
  assert.equal(httpUrlOnly("https://creativecommons.org/licenses/by/4.0/"), "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(httpUrlOnly("http://x.example/l"), "http://x.example/l");
  for (const bad of ["javascript:alert(1)", "data:text/html,<p>", "file:///etc/passwd", "ftp://x.example", "//x.example", "nonsense", "", undefined, 5]) assert.equal(httpUrlOnly(bad), "", String(bad));
  assert.equal(mapOpenverseResult({ id: "a", license_url: "javascript:alert(1)" }).license_url, "");
});

test("a sidecar's non-http licence url is dropped when it is read back", async () => {
  const t = await startApp();
  try {
    const { id } = await create(t);
    const dir = path.join(t.dataDir, "projects", id);
    fs.writeFileSync(path.join(dir, "assets", "stock-a.png"), makePng(2, 2));
    fs.writeFileSync(path.join(dir, "assets", "stock-a.png.json"), JSON.stringify({ url: "https://x.example/a.png", credit: "Jo", license: "CC BY", licenseUrl: "javascript:alert(1)", source: "x", fetchedAt: "now" }));
    const { syncAssets } = await import("../server/assets.mjs");
    const [asset] = await syncAssets(t.app.store, id);
    assert.equal(asset.kind, "stock");
    assert.equal(asset.licenseUrl, "");
  } finally {
    await t.close();
  }
});

test("images over 100 megapixels are refused on upload and in fetch_image", async () => {
  const t = await startApp();
  try {
    const { id } = await create(t);
    const res = await upload(t, id, "huge.png", hugePng(10001, 10000));
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error.code, "IMAGE_TOO_LARGE");
    assert.equal((await upload(t, id, "ok.png", hugePng(10000, 10000))).status, 201, "exactly 100 MP is allowed");
    await assert.rejects(normaliseImage(hugePng(20000, 20000)), /megapixels/);
  } finally {
    await t.close();
  }
});

// ---- B5 / B10 ---------------------------------------------------------------------------------

test("concurrent uploads of one name get unique files and never overwrite", async () => {
  const t = await startApp();
  try {
    const { id } = await create(t);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => upload(t, id, "face.png", makePng(4 + i, 4)).then((r) => r.json())));
    const names = results.map((r) => r.name);
    assert.equal(new Set(names).size, 8, names.join());
    const project = (await t.api("GET", `/api/projects/${id}`)).body;
    assert.equal(project.assets.length, 8);
    for (const r of results) assert.equal(fs.statSync(path.join(t.dataDir, "projects", id, "assets", r.name)).isFile(), true);
  } finally {
    await t.close();
  }
});

test("a photo project is sized by exactly one of several concurrent first uploads", async () => {
  const t = await startApp();
  try {
    const p = (await t.api("POST", "/api/projects", { preset: "photo", brief: { instruction: "x", aspect: "original" } })).body;
    const sizes = [[400, 200], [100, 300], [640, 480]];
    await Promise.all(sizes.map(([w, h], i) => upload(t, p.id, `p${i}.png`, makePng(w, h))));
    const after = (await t.api("GET", `/api/projects/${p.id}`)).body;
    assert.ok(sizes.some(([w, h]) => after.size.width === w && after.size.height === h), JSON.stringify(after.size));
  } finally {
    await t.close();
  }
});

test("writeUnique claims names atomically (cut-out naming)", async () => {
  const dir = tempDir("imago-unique-");
  const names = await Promise.all(["face-cutout.png", "face-cutout.png", "face-cutout.png"].map((n) => writeUnique(dir, n, Buffer.from("x"))));
  assert.deepEqual(names.sort(), ["face-cutout-2.png", "face-cutout-3.png", "face-cutout.png"]);
});

test("restoring a version whose snapshot file is gone is a 404", { timeout: 120_000 }, async (ctx) => {
  const t = await startApp();
  try {
    if (!(await rendererReady(t))) return ctx.skip("renderer not ready");
    const { id } = await create(t);
    await eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { text: "go" }), done);
    fs.rmSync(path.join(t.dataDir, "projects", id, "versions", "v1.html"));
    const res = await t.api("POST", `/api/projects/${id}/restore`, { version: 1 });
    assert.equal(res.status, 404);
    assert.equal((await t.api("POST", `/api/projects/${id}/restore`, { version: 1 })).status, 404, "the slot was released");
  } finally {
    await t.close();
  }
});

test("thumbnails ignore a size in the body (no BAD_SIZE)", async () => {
  const t = await startApp();
  try {
    for (const size of [{ width: 5, height: 5 }, "junk", { width: 100 }]) {
      const res = await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "T" }, size });
      assert.equal(res.status, 201, JSON.stringify(size));
      assert.deepEqual(res.body.size, { width: 1280, height: 720 });
    }
    assert.equal((await t.api("POST", "/api/projects", { preset: "graphic", brief: { description: "x" }, size: { width: 5, height: 5 } })).status, 400);
  } finally {
    await t.close();
  }
});

// ---- B2 / B3 / B4 / B1 ------------------------------------------------------------------------

test("running is on disk before the 202; a failure before init keeps the brief for the next turn", { timeout: 120_000 }, async (ctx) => {
  const t = await startApp();
  try {
    if (!(await rendererReady(t))) return ctx.skip("renderer not ready");
    const { id } = await create(t, "thumbnail");
    await withMode("early-fail", async () => {
      const events = await eventsDuring(t.base, id, async () => {
        const res = await t.api("POST", `/api/projects/${id}/messages`, { text: "make it" });
        assert.equal(res.status, 202);
        assert.equal((await t.api("GET", `/api/projects/${id}`)).body.running, true, "running is already true");
      }, done, 30_000);
      assert.equal(events.find((e) => e.event === "run.error").data.code, "EXITED");
    });
    const failed = (await t.api("GET", `/api/projects/${id}`)).body;
    assert.equal(failed.running, false);
    assert.equal(failed.sessionId, null);
    assert.equal(failed.briefSent, false);
    assert.equal(failed.messages.length, 1);

    // The next turn (messages.length is now 2) must still carry the brief.
    await eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { text: "try again" }), done);
    const call = JSON.parse(fs.readFileSync(path.join(t.dataDir, "projects", id, "fake-claude-call.json"), "utf8"));
    assert.match(call.stdin, /Video title or topic: Rockets/);
    assert.match(call.stdin, /try again$/);
    const ok = (await t.api("GET", `/api/projects/${id}`)).body;
    assert.equal(ok.briefSent, true);
    assert.equal(ok.sessionId, "fake-session-1");

    // Once the session exists the brief is not repeated.
    await eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { text: "bigger" }), done);
    assert.equal(JSON.parse(fs.readFileSync(path.join(t.dataDir, "projects", id, "fake-claude-call.json"), "utf8")).stdin, "bigger");
  } finally {
    await t.close();
  }
});

test("a project whose Claude session is gone starts fresh once, with a recap, instead of failing forever", { timeout: 120_000 }, async (ctx) => {
  const t = await startApp();
  try {
    if (!(await rendererReady(t))) return ctx.skip("renderer not ready");
    const { id } = await create(t);
    await eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { text: "A rocket poster" }), done);
    const dir = path.join(t.dataDir, "projects", id);
    assert.equal((await t.api("GET", `/api/projects/${id}`)).body.sessionId, "fake-session-1");

    const out = path.join(tempDir(), "args.jsonl");
    process.env.FAKE_CLAUDE_ARGS_OUT = out;
    try {
      const events = await withMode("resume-fail", () => eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { text: "Make the rocket bigger" }), done));
      // The first attempt resumed and found nothing; the retry has no --resume. (The fake only fails on --resume.)
      assert.ok(events.some((e) => e.event === "run.finished"), JSON.stringify(events.map((e) => e.event)));
      const calls = fs.readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      assert.equal(calls.length, 2, "the failed resume, then one fresh retry");
      assert.equal(calls[0].argv[calls[0].argv.indexOf("--resume") + 1], "fake-session-1");
      assert.equal(calls[0].stdin, "Make the rocket bigger");
      const retry = calls[1];
      assert.ok(!retry.argv.includes("--resume"));
      assert.match(retry.stdin, /A poster/);
      assert.match(retry.stdin, /Owner: A rocket poster/);
      assert.match(retry.stdin, /You: Drafting the design\./);
      assert.match(retry.stdin, /design\.html already exists/);
      assert.match(retry.stdin, /Make the rocket bigger$/);
    } finally {
      delete process.env.FAKE_CLAUDE_ARGS_OUT;
    }
    const after = (await t.api("GET", `/api/projects/${id}`)).body;
    assert.equal(after.running, false);
    assert.equal(after.sessionId, "fake-session-1", "the new session is stored");
    assert.equal(after.briefSent, true);
    assert.ok(fs.existsSync(path.join(dir, "design.html")));
  } finally {
    await t.close();
  }
});

test("buildRecoveryPrompt keeps the last ten messages, truncated", () => {
  const history = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i} ${"x".repeat(900)}` }));
  const prompt = buildRecoveryPrompt({ preset: "graphic", brief: { description: "A poster" } }, history, "next", false);
  assert.match(prompt, /A poster/);
  assert.ok(!prompt.includes("m3 "));
  assert.ok(prompt.includes("m4 "));
  assert.ok(prompt.length < 7000);
  assert.ok(!/design\.html already exists/.test(prompt));
  assert.match(prompt, /next$/);
});

// ---- B7 / S6 ----------------------------------------------------------------------------------

test("delete waits for the running turn; export is refused while one runs", async () => {
  const t = await withMode("slow", () => startApp());
  try {
    await withMode("slow", async () => {
      const { id } = await create(t);
      assert.equal((await t.api("POST", `/api/projects/${id}/messages`, { text: "go" })).status, 202);
      await new Promise((r) => setTimeout(r, 400));
      const exp = await t.api("POST", `/api/projects/${id}/export`, { format: "png", scale: 1 });
      assert.equal(exp.status, 409);
      assert.equal(exp.body.error.code, "TURN_RUNNING");
      assert.equal((await t.api("POST", `/api/projects/${id}/restore`, { version: 1 })).status, 409);
      const del = await t.api("DELETE", `/api/projects/${id}`);
      assert.equal(del.status, 200);
      assert.equal(fs.existsSync(path.join(t.dataDir, "projects", id)), false, "nothing recreated the folder after the delete");
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(fs.existsSync(path.join(t.dataDir, "projects", id)), false);
    });
  } finally {
    await t.close();
  }
});
