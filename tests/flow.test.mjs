import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { eventsDuring, makePng, startApp } from "./helpers.mjs";
import { imageInfo } from "../server/image-info.mjs";

const done = (e) => e.event === "run.finished" || e.event === "run.error";

test("presets, fonts and capabilities", async () => {
  const t = await startApp();
  try {
    assert.equal((await t.api("GET", "/api/health")).body.ok, true);
    const presets = (await t.api("GET", "/api/presets")).body;
    assert.deepEqual(presets.map((p) => p.id), ["thumbnail", "photo", "graphic"]);
    assert.deepEqual(presets[0].chips, ["Bigger text", "More contrast", "Swap sides", "Another direction"]);
    assert.deepEqual(presets[1].chips, ["Warmer", "Cooler", "Tighter crop", "Remove background"]);
    assert.deepEqual(presets[2].chips, ["Simplify", "Bolder", "Different palette"]);
    assert.ok(presets.every((p) => p.label && p.description && p.sizes.length && p.briefFields.length));
    const fonts = (await t.api("GET", "/api/fonts")).body;
    assert.ok(fonts.families.some((f) => f.family === "Anton"));
    const css = await (await fetch(`${t.base}/fonts/fonts.css`)).text();
    assert.match(css, /font-family: "Bebas Neue"/);
    assert.equal((await fetch(`${t.base}/fonts/Anton.ttf`)).status, 200);

    const caps = (await t.api("GET", "/api/capabilities")).body;
    assert.equal(caps.claude.state, "ready");
    assert.equal(caps.model, "claude-sonnet-5-5");
    assert.equal(caps.effort, "medium");
    assert.ok(["ready", "missing"].includes(caps.renderer.state));
    if (caps.renderer.state === "missing") assert.ok(caps.renderer.fix && caps.renderer.reason);
  } finally {
    await t.close();
  }
});

test("project validation", async () => {
  const t = await startApp();
  try {
    assert.equal((await t.api("POST", "/api/projects", { preset: "nope" })).status, 400);
    assert.equal((await t.api("POST", "/api/projects", { preset: "graphic", size: { width: 10, height: 2000 } })).status, 400);
    assert.equal((await t.api("GET", "/api/projects/does-not-exist")).status, 404);
    assert.equal((await t.api("GET", "/api/projects/Bad..Id")).status, 400);
    assert.equal((await t.api("POST", "/api/projects/does-not-exist/messages", { text: "x" })).status, 404);
    const p = (await t.api("POST", "/api/projects", { preset: "graphic", brief: { description: "A poster" }, size: { width: 1080, height: 1350 } })).body;
    assert.deepEqual(p.size, { width: 1080, height: 1350 });
    assert.equal((await t.api("POST", `/api/projects/${p.id}/messages`, { text: "  " })).status, 400);
    const bad = await fetch(`${t.base}/api/projects/${p.id}/assets`, { method: "POST", headers: { "x-filename": "a.gif" }, body: Buffer.from("GIF89a" + "x".repeat(40)) });
    assert.equal(bad.status, 415);
    assert.equal((await t.api("POST", `/api/projects/${p.id}/export`, { format: "png", scale: 1 })).status, 422, "nothing to export yet");
  } finally {
    await t.close();
  }
});

test("photo projects take their canvas from the first upload", async () => {
  const t = await startApp();
  try {
    const p = (await t.api("POST", "/api/projects", { preset: "photo", brief: { instruction: "warmer", aspect: "1:1" } })).body;
    assert.equal(p.sizeAuto, true);
    await fetch(`${t.base}/api/projects/${p.id}/assets`, { method: "POST", headers: { "x-filename": "p.png" }, body: makePng(400, 200) });
    assert.deepEqual((await t.api("GET", `/api/projects/${p.id}`)).body.size, { width: 200, height: 200 });
  } finally {
    await t.close();
  }
});

test("end to end: create, upload, message, render, restore, export", { timeout: 240_000 }, async (ctx) => {
  const t = await startApp();
  try {
    const caps = (await t.api("GET", "/api/capabilities")).body;
    if (caps.renderer.state !== "ready") return ctx.skip(`renderer not ready: ${caps.renderer.reason}`);

    const created = await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "Rockets are cool", channelColours: "orange", notes: "" } });
    assert.equal(created.status, 201);
    const project = created.body;
    assert.deepEqual(project.size, { width: 1280, height: 720 });
    assert.equal(project.title, "Rockets are cool");
    const id = project.id;

    const upload = await fetch(`${t.base}/api/projects/${id}/assets`, { method: "POST", headers: { "x-filename": encodeURIComponent("My Face.png") }, body: makePng(64, 48) });
    assert.equal(upload.status, 201);
    const asset = await upload.json();
    assert.deepEqual(asset, { name: "My-Face.png", width: 64, height: 48 });
    assert.equal((await fetch(`${t.base}/projects/${id}/assets/My-Face.png`)).headers.get("content-type"), "image/png");

    const events = await eventsDuring(t.base, id, async () => {
      const res = await t.api("POST", `/api/projects/${id}/messages`, { text: "Make it punchy" });
      assert.equal(res.status, 202);
      assert.equal((await t.api("POST", `/api/projects/${id}/messages`, { text: "again" })).status, 409, "TURN_RUNNING");
    }, done);

    const names = events.map((e) => e.event);
    assert.equal(names[0], "snapshot");
    for (const expected of ["run.started", "assistant.text", "tool.use", "render.done", "run.finished"]) assert.ok(names.includes(expected), `${expected} in ${names}`);
    assert.ok(names.indexOf("render.done") < names.indexOf("run.finished"));
    const render = events.find((e) => e.event === "render.done").data;
    assert.equal(render.version, 1);
    assert.equal(render.url, `/projects/${id}/renders/v1.png`);
    assert.deepEqual(render.warnings, []);
    assert.ok(events.some((e) => e.event === "tool.use" && e.data.summary === "Rendering"));
    const toolDone = events.filter((e) => e.event === "tool.done").map((e) => [e.data.name, e.data.ok]);
    assert.deepEqual(toolDone, [["Write", true], ["mcp__imago__render", true]]);
    assert.equal((await t.api("GET", `/api/projects/${id}`)).body.briefSent, true);
    const finished = events.find((e) => e.event === "run.finished").data;
    assert.equal(finished.ok, true);
    assert.equal(finished.costUsd, 0);

    const dir = path.join(t.dataDir, "projects", id);
    const png = fs.readFileSync(path.join(dir, "renders", "v1.png"));
    assert.deepEqual(imageInfo(png), { type: "png", width: 1280, height: 720 });
    assert.ok(fs.existsSync(path.join(dir, "versions", "v1.html")));
    const served = await fetch(`${t.base}${render.url}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("cache-control"), "no-store");

    // How claude was called.
    const call = JSON.parse(fs.readFileSync(path.join(dir, "fake-claude-call.json"), "utf8"));
    const arg = (name) => call.argv[call.argv.indexOf(name) + 1];
    assert.equal(arg("--model"), "claude-sonnet-5-5");
    assert.equal(arg("--effort"), "medium");
    assert.equal(arg("--setting-sources"), "");
    assert.ok(call.argv.includes("--strict-mcp-config"));
    for (const flag of ["--restricted", "--disable-slash-commands"]) assert.ok(call.argv.includes(flag), flag);
    assert.equal(arg("--tools"), "Read,Write,Edit,Glob");
    assert.equal(arg("--permission-mode"), "dontAsk");
    assert.equal(arg("--permission-prompts"), "none");
    assert.equal(arg("--allowedTools"), "Read(./**),Glob(./**),Write(./design.html),Edit(./design.html),mcp__imago__render,mcp__imago__cut_out");
    const denied = arg("--disallowedTools").split(",");
    for (const rule of ["Bash", "WebFetch", "WebSearch", "Write(./project.json)", "Edit(./versions/**)", "Write(./renders/**)", "Edit(./exports/**)"]) assert.ok(denied.includes(rule), rule);
    assert.ok(!call.argv.includes("--append-system-prompt"), "the prompt is not on the command line");
    assert.ok(!fs.existsSync(call.systemFile), "the prompt file is removed after the turn");
    assert.ok(!call.systemFile.startsWith(dir), "the prompt file lives outside the project");
    assert.match(call.systemPrompt, /assets\/My-Face\.png \(64×48\)/);
    assert.match(call.stdin, /Video title or topic: Rockets are cool/);
    assert.match(call.stdin, /Make it punchy$/);
    assert.ok(!call.argv.includes("--resume"));

    const after = (await t.api("GET", `/api/projects/${id}`)).body;
    assert.equal(after.sessionId, "fake-session-1");
    assert.equal(after.current, 1);
    assert.equal(after.running, false);
    assert.deepEqual(after.versions.map((v) => v.n), [1]);
    assert.deepEqual(after.messages.map((m) => m.role), ["user", "assistant", "assistant"]);
    assert.equal(after.messages.at(-1).version, 1);
    assert.equal(after.assets.length, 1);

    // The preview of the design and of a snapshot.
    const design = await fetch(`${t.base}/projects/${id}/design.html`);
    assert.match(design.headers.get("content-security-policy"), /^sandbox; default-src 'none'/);
    const snap = await (await fetch(`${t.base}/projects/${id}/versions/v1.html`)).text();
    assert.ok(snap.includes(`<base href="/projects/${id}/">`));

    // A second turn resumes the session and sends the text as it is.
    const second = await eventsDuring(t.base, id, () => t.api("POST", `/api/projects/${id}/messages`, { text: "Bigger text" }), done);
    assert.ok(second.some((e) => e.event === "run.finished"));
    const call2 = JSON.parse(fs.readFileSync(path.join(dir, "fake-claude-call.json"), "utf8"));
    assert.equal(call2.argv[call2.argv.indexOf("--resume") + 1], "fake-session-1");
    assert.equal(call2.stdin, "Bigger text");
    const v2 = (await t.api("GET", `/api/projects/${id}`)).body;
    assert.equal(v2.current, 2);

    // Restore version 1.
    const restored = await t.api("POST", `/api/projects/${id}/restore`, { version: 1 });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.current, 1);
    assert.equal(fs.readFileSync(path.join(dir, "design.html"), "utf8"), fs.readFileSync(path.join(dir, "versions", "v1.html"), "utf8"));
    assert.equal((await t.api("POST", `/api/projects/${id}/restore`, { version: 9 })).status, 404);

    // Export.
    const exp = await t.api("POST", `/api/projects/${id}/export`, { format: "png", scale: 2 });
    assert.equal(exp.status, 200, JSON.stringify(exp.body));
    assert.equal(exp.body.width, 2560);
    assert.equal(exp.body.height, 1440);
    const exported = fs.readFileSync(path.join(dir, "exports", exp.body.name));
    assert.deepEqual(imageInfo(exported), { type: "png", width: 2560, height: 1440 });
    assert.equal(exp.body.bytes, exported.length);
    const jpg = await t.api("POST", `/api/projects/${id}/export`, { format: "jpg", scale: 1 });
    assert.equal(jpg.status, 200, JSON.stringify(jpg.body));
    assert.deepEqual(imageInfo(fs.readFileSync(path.join(dir, "exports", jpg.body.name))), { type: "jpeg", width: 1280, height: 720 });
    const webp = await t.api("POST", `/api/projects/${id}/export`, { format: "webp", scale: 1 });
    assert.deepEqual(imageInfo(fs.readFileSync(path.join(dir, "exports", webp.body.name))), { type: "webp", width: 1280, height: 720 });
    assert.equal((await fetch(`${t.base}${jpg.body.url}`)).status, 200);

    const list = (await t.api("GET", "/api/projects")).body;
    assert.equal(list[0].thumbnail, `/projects/${id}/renders/v1.png`);
    assert.equal((await t.api("DELETE", `/api/projects/${id}`)).status, 200);
    assert.equal((await t.api("GET", `/api/projects/${id}`)).status, 404);
  } finally {
    await t.close();
  }
});

test("thumbnail formats set the canvas; oversized export scales are refused", async () => {
  const t = await startApp();
  try {
    const shorts = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "T", format: "shorts" } })).body;
    assert.deepEqual(shorts.size, { width: 720, height: 1280 });
    assert.equal(shorts.brief.format, "shorts");
    const podcast = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "T", format: "podcast" } })).body;
    assert.deepEqual(podcast.size, { width: 1280, height: 1280 });
    const dflt = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "T" } })).body;
    assert.deepEqual(dflt.size, { width: 1280, height: 720 });
    assert.equal(dflt.brief.format, "video");
    assert.equal((await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "T", format: "nope" } })).status, 400);
    const presets = (await t.api("GET", "/api/presets")).body;
    assert.ok(presets.find((p) => p.id === "graphic").sizes.every((s) => s.group));
    const big = (await t.api("POST", "/api/projects", { preset: "graphic", brief: { description: "x" }, size: { width: 4096, height: 4096 } })).body;
    const r = await t.api("POST", `/api/projects/${big.id}/export`, { format: "png", scale: 3 });
    assert.equal(r.status, 400);
    assert.equal(r.body.error?.code ?? r.body.code, "BAD_SCALE");
  } finally {
    await t.close();
  }
});
