// Concept sets: planner, parallel design turns, fallback, cancel, another concept, compare data and exports.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fallbackConcepts, validateConcepts } from "../server/concept-sets.mjs";
import { loadConfig } from "../server/config.mjs";
import { imageInfo } from "../server/image-info.mjs";
import { renderHtml } from "../server/renderer.mjs";
import { THUMBNAIL_ARCHETYPES } from "../server/presets/index.mjs";
import { makePng, startApp, tempDir } from "./helpers.mjs";
import { writeKit } from "./fixtures/kit.mjs";

const rendererReady = async (t) => (await t.api("GET", "/api/capabilities")).body.renderer.state === "ready";
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
async function until(read, ok, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`timed out; last: ${JSON.stringify(value).slice(0, 600)}`);
    await sleep(80);
  }
}
const getSet = async (t, id) => (await t.api("GET", `/api/concept-sets/${id}`)).body;
const finished = (s) => ["done", "failed", "cancelled"].includes(s.state);
/** Entries of a store-only zip. */
function unzip(buf) {
  const out = [];
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.toString("ascii", at + 30, at + 30 + nameLen);
    const start = at + 30 + nameLen;
    out.push({ name, data: buf.subarray(start, start + size) });
    at = start + size;
  }
  return out;
}
const readCalls = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];

async function setup({ kitRoot = true, ...overrides } = {}) {
  const root = tempDir();
  if (kitRoot) writeKit(root);
  const cutCalls = [];
  const t = await startApp({ fabulaRoots: [root], ...overrides }, {
    cutOut: async (dir, asset) => {
      cutCalls.push(asset);
      const name = asset.replace(/\.[^.]+$/, "-cutout.png");
      fs.writeFileSync(path.join(dir, "assets", name), makePng(20, 30));
      return { name, width: 20, height: 30, from: asset };
    },
  });
  const kit = kitRoot ? (await t.api("GET", "/api/kits")).body.items[0] : null;
  return { t, kit, cutCalls, argsFile: path.join(tempDir(), "args.jsonl") };
}

test("validateConcepts accepts the plan's shape and refuses everything else", () => {
  const assets = new Set(["kit-f01.jpg", "kit-boss.png"]);
  const good = (extra = {}) => ({ archetype: "reaction", label: "Shocked look", idea: "A face.", text: "WE DID IT", frame: "assets/kit-f01.jpg", pictures: ["assets/kit-boss.png"], why: "Because.", ...extra });
  const ok = validateConcepts({ concepts: [good(), good({ archetype: "number", frame: undefined, pictures: undefined })] }, { count: 2, assets });
  assert.equal(ok.ok, true);
  assert.equal(ok.concepts[1].frame, undefined);
  const bad = (concepts, count = concepts.length) => validateConcepts({ concepts }, { count, assets });
  assert.equal(bad([good()], 2).ok, false, "wrong count");
  assert.equal(bad([good(), good()]).ok, false, "repeated archetype");
  assert.equal(bad([good({ archetype: "made-up" })]).ok, false);
  assert.equal(bad([good({ text: "ONE TWO THREE FOUR FIVE" })]).ok, false, "more than four words");
  assert.equal(bad([good({ frame: "assets/missing.jpg" })]).ok, false);
  assert.equal(bad([good({ frame: "assets/../project.json" })]).ok, false);
  assert.equal(bad([good({ pictures: ["assets/nope.png"] })]).ok, false);
  assert.equal(bad([good({ label: "" })]).ok, false);
  assert.equal(bad([good({ why: undefined })]).ok, false);
  assert.equal(validateConcepts(null, { count: 1, assets }).ok, false);
  assert.equal(validateConcepts({ concepts: "x" }, { count: 1, assets }).ok, false);
});

test("fallback concepts use distinct archetypes, spread the faces and skip used archetypes", () => {
  const kit = { frames: [{ file: "frames/f01.jpg", kind: "face", score: 0.9 }, { file: "frames/f02.jpg", kind: "face", score: 0.5 }, { file: "frames/s01.jpg", kind: "screen" }], pictures: [{ file: "pictures/a.png" }] };
  const records = [{ kitFile: "frames/f01.jpg", name: "kit-f01.jpg" }, { kitFile: "frames/f02.jpg", name: "kit-f02.jpg" }, { kitFile: "frames/s01.jpg", name: "kit-s01.jpg" }, { kitFile: "pictures/a.png", name: "kit-a.png" }];
  const three = fallbackConcepts({ count: 3, kit, records });
  assert.equal(new Set(three.map((c) => c.archetype)).size, 3);
  assert.ok(three.every((c) => THUMBNAIL_ARCHETYPES.includes(c.archetype) && c.label && c.idea && c.why && c.text === null));
  assert.notEqual(three[0].frame, three[1].frame);
  const more = fallbackConcepts({ count: 1, kit, records, used: three.map((c) => c.archetype) });
  assert.ok(!three.some((c) => c.archetype === more[0].archetype));
  assert.equal(fallbackConcepts({ count: 8, kit: null }).length, 8);
  assert.equal(fallbackConcepts({ count: 3 }).every((c) => c.frame === undefined), true);
  assert.deepEqual(fallbackConcepts({ count: 2, uploads: ["me.png"] }).map((c) => c.frame), ["assets/me.png", "assets/me.png"]);
});

test("a set of three: planner, three parallel design turns, siblings, shared cut-outs and the compare data", async () => {
  const { t, kit, cutCalls, argsFile } = await setup();
  const trace = path.join(tempDir(), "trace.jsonl");
  try {
    assert.equal((await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 7 })).status, 400);
    assert.equal((await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 1 })).status, 400);
    assert.equal((await t.api("POST", "/api/concept-sets", { kit: "0".repeat(16), count: 3 })).status, 404);
    assert.equal((await t.api("POST", "/api/concept-sets", { count: 3, brief: {} })).status, 400, "no kit and no title");

    const created = await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 3, brief: {} });
    assert.equal(created.status, 201);
    const draft = created.body;
    assert.equal(draft.state, "draft");
    assert.equal(draft.concepts.length, 3);
    assert.equal(draft.kit.title, "We released the game");
    const projects = (await t.api("GET", "/api/projects")).body.items;
    assert.equal(projects.length, 3);
    assert.ok(projects.every((p) => p.conceptSet?.id === draft.id));
    assert.deepEqual(projects.map((p) => p.conceptSet.index).sort(), [0, 1, 2]);

    await withEnv({ FAKE_CLAUDE_ARGS_OUT: argsFile, FAKE_CLAUDE_TRACE: trace, FAKE_CLAUDE_DELAY_MS: "900" }, async () => {
      assert.equal((await t.api("POST", `/api/concept-sets/${draft.id}/start`)).status, 202);
      assert.equal((await t.api("POST", `/api/concept-sets/${draft.id}/start`)).status, 409, "a set starts once");
      const set = await until(() => getSet(t, draft.id), finished);
      assert.equal(set.state, "done");
      assert.equal(set.plan.source, "planner");
      assert.deepEqual(set.concepts.map((c) => c.state), ["done", "done", "done"]);
      assert.equal(new Set(set.concepts.map((c) => c.archetype)).size, 3);
      assert.deepEqual(set.concepts.map((c) => c.label), ["Concept 1 label", "Concept 2 label", "Concept 3 label"]);
      assert.ok(set.concepts.every((c) => c.renderUrl && c.versionCount === 1 && c.idea && c.why));
      assert.ok(set.costUsd >= 0.01, "the planner's cost is counted");
      assert.equal(set.testCompare, true);
    });

    // Parallel: the three design turns overlapped.
    const events = readCalls(trace);
    let live = 0;
    let peak = 0;
    for (const e of events.sort((a, b) => a.t - b.t)) {
      live += e.event === "start" ? 1 : -1;
      peak = Math.max(peak, live);
    }
    assert.equal(peak, 3);

    const calls = readCalls(argsFile);
    const planner = calls.filter((c) => !c.argv.includes("--resume") && /concept planner/.test(c.systemPrompt ?? ""));
    assert.equal(planner.length, 1);
    const designs = calls.filter((c) => /Your concept/.test(c.systemPrompt ?? ""));
    assert.equal(designs.length, 3);
    assert.equal(calls.length, 4);
    const prompts = designs.map((c) => c.systemPrompt);
    for (const sp of prompts) {
      assert.match(sp, /## Your concept/);
      assert.equal((sp.match(/^Concept \d$/gm) ?? []).length, 2, "two siblings");
      assert.match(sp, /Archetype: /);
    }
    assert.ok(designs.every((c) => /Make concept \d of 3: "Concept \d label"/.test(c.stdin)));
    assert.ok(designs.every((c) => /## From the video/.test(c.stdin)), "the design turns get the kit too");

    // The planner is as locked down as a design turn, and runs in its own folder.
    const a = planner[0].argv;
    assert.ok(a.includes("--restricted"));
    assert.equal(flagOf(a, "--permission-mode"), "dontAsk");
    assert.equal(flagOf(a, "--permission-prompts"), "none");
    assert.equal(flagOf(a, "--tools"), "Read,Write,Glob");
    assert.equal(flagOf(a, "--allowedTools"), "Read(./**),Glob(./**),Edit(./concepts.json)");
    for (const denied of ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit", "Edit(./assets/**)", "Edit(./reference/**)"]) assert.ok(flagOf(a, "--disallowedTools").split(",").includes(denied), denied);
    assert.ok(a.includes("--strict-mcp-config"));
    assert.ok(a.includes("--disable-slash-commands"));
    assert.equal(flagOf(a, "--setting-sources"), "");
    assert.deepEqual(JSON.parse(flagOf(a, "--mcp-config")), { mcpServers: {} });
    assert.ok(!a.join(" ").includes("mcp__imago"));
    assert.equal(flagOf(a, "--model"), t.config.model);
    assert.ok(a.includes("--append-system-prompt-file"));
    assert.ok(!JSON.stringify(a).includes(planner[0].systemPrompt.slice(0, 40)), "the system prompt stays off the command line");
    assert.match(planner[0].stdin, /Plan 3 different thumbnail concepts/);
    assert.match(planner[0].stdin, /## From the video/);
    assert.match(planner[0].stdin, /Contact sheet/);
    assert.match(planner[0].systemPrompt, /You plan 3 different/);
    assert.match(planner[0].systemPrompt, /video thumbnail, 16:9/);
    // Design turns never got the planner's folder as their session.
    const sessions = (await t.api("GET", "/api/projects")).body.items.map((p) => p.id);
    assert.equal(sessions.length, 3);
    assert.ok(!fs.existsSync(path.join(t.config.dataDir, "concept-sets", draft.id, "work", "assets")), "the planner's copies of the kit are removed afterwards");
    assert.ok(fs.existsSync(path.join(t.config.dataDir, "concept-sets", draft.id, "work", "concepts.json")));

    // One cut-out per distinct face frame (f01 and f02 for three concepts), copied to the projects that use them.
    assert.deepEqual([...cutCalls].sort(), ["kit-f01.jpg", "kit-f02.jpg"]);
    const full = await Promise.all(sessions.map(async (id) => (await t.api("GET", `/api/projects/${id}`)).body));
    const cutAssets = full.map((p) => p.assets.filter((x) => x.kind === "cutout").map((x) => x.name));
    assert.deepEqual(cutAssets.map((c) => c.length), [1, 1, 1]);
    assert.ok(full.every((p) => p.conceptSet.archetype && p.title.includes("label")));
    assert.ok(designs.some((c) => /A cut-out of its main picture is ready: assets\/kit-f0[12]-cutout\.png/.test(c.stdin)));

    // Feed neighbours exclude the set's own siblings.
    assert.ok(designs.length === 3);
  } finally {
    await t.close();
  }
});

test("the concurrency cap holds", async () => {
  const { t, kit } = await setup({ conceptConcurrency: 2 });
  const trace = path.join(tempDir(), "trace.jsonl");
  try {
    const set = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 3, brief: {} })).body;
    await withEnv({ FAKE_CLAUDE_TRACE: trace, FAKE_CLAUDE_DELAY_MS: "700" }, async () => {
      await t.api("POST", `/api/concept-sets/${set.id}/start`);
      assert.equal((await until(() => getSet(t, set.id), finished)).state, "done");
    });
    let live = 0;
    let peak = 0;
    for (const e of readCalls(trace).sort((a, b) => a.t - b.t)) {
      live += e.event === "start" ? 1 : -1;
      peak = Math.max(peak, live);
    }
    assert.equal(peak, 2);
  } finally {
    await t.close();
  }
  assert.equal(loadConfig({ IMAGO_CONCEPT_CONCURRENCY: "5" }).conceptConcurrency, 5);
  assert.equal(loadConfig({}).conceptConcurrency, 3);
  assert.equal(loadConfig({ IMAGO_CONCEPT_CONCURRENCY: "x" }).conceptConcurrency, 3);
  assert.deepEqual(loadConfig({ IMAGO_FABULA_PROJECTS: "/a, /b" }).fabulaRoots, ["/a", "/b"]);
});

test("a missing, invalid or repeating plan falls back to server-chosen archetypes", async () => {
  for (const kind of ["invalid", "missing", "duplicate"]) {
    const { t, kit } = await setup();
    try {
      const set = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 3, brief: {} })).body;
      await withEnv({ FAKE_CLAUDE_PLANNER: kind }, async () => {
        await t.api("POST", `/api/concept-sets/${set.id}/start`);
        const done = await until(() => getSet(t, set.id), finished);
        assert.equal(done.plan.source, "fallback", kind);
        assert.match(done.plan.note, /Imago chose/);
        assert.equal(done.state, "done");
        assert.equal(new Set(done.concepts.map((c) => c.archetype)).size, 3);
        assert.ok(done.concepts.every((c) => c.state === "done" && c.label));
      });
    } finally {
      await t.close();
    }
  }
});

test("one failing concept never fails the others, and a signed-out Claude fails the set plainly", async () => {
  const { t, kit } = await setup();
  try {
    const set = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 3, brief: {} })).body;
    await withEnv({ FAKE_CLAUDE_FAIL_WHEN: "Make concept 2 of" }, async () => {
      await t.api("POST", `/api/concept-sets/${set.id}/start`);
      const done = await until(() => getSet(t, set.id), finished);
      assert.deepEqual(done.concepts.map((c) => c.state), ["done", "failed", "done"]);
      assert.equal(done.state, "done");
      assert.ok(done.concepts[1].error);
      assert.ok(done.concepts[0].renderUrl && done.concepts[2].renderUrl);
    });
    const other = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 2, brief: {} })).body;
    await withEnv({ FAKE_CLAUDE_MODE: "signed-out" }, async () => {
      await t.api("POST", `/api/concept-sets/${other.id}/start`);
      const done = await until(() => getSet(t, other.id), finished);
      assert.equal(done.state, "failed");
      assert.match(done.concepts[0].error, /not signed in/);
    });
  } finally {
    await t.close();
  }
});

test("a set made without a kit takes uploads for every concept, and a vertical set is not for Test & Compare", async () => {
  const { t } = await setup({ kitRoot: false });
  try {
    const made = await t.api("POST", "/api/concept-sets", { count: 2, title: "Cats", brief: { title: "Cats", format: "shorts", platforms: ["tiktok", "instagram-reels"] } });
    assert.equal(made.status, 201);
    const set = made.body;
    assert.equal(set.format, "shorts");
    assert.equal(set.testCompare, false);
    const up = await fetch(`${t.base}/api/concept-sets/${set.id}/assets`, { method: "POST", headers: { "x-filename": "me.png" }, body: makePng(30, 40) });
    assert.equal(up.status, 201);
    assert.equal((await fetch(`${t.base}/api/concept-sets/${set.id}/assets`, { method: "POST", body: makePng(3, 3) })).status, 400);
    for (const c of set.concepts) assert.equal((await t.api("GET", `/api/projects/${c.projectId}`)).body.assets[0].name, "me.png");
    await t.api("POST", `/api/concept-sets/${set.id}/start`);
    const done = await until(() => getSet(t, set.id), finished);
    assert.equal(done.state, "done");
    assert.equal(done.plan.source, "planner");
    assert.equal((await fetch(`${t.base}/api/concept-sets/${set.id}/assets`, { method: "POST", headers: { "x-filename": "late.png" }, body: makePng(3, 3) })).status, 409);
    assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/test-compare`, {})).status, 400);
    const p = (await t.api("GET", `/api/projects/${done.concepts[0].projectId}`)).body;
    assert.deepEqual(p.brief.platforms, ["tiktok", "instagram-reels"]);
  } finally {
    await t.close();
  }
});

test("cancelling a set stops the planner and every design turn", async () => {
  const { t, kit } = await setup();
  try {
    const set = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 3, brief: {} })).body;
    await withEnv({ FAKE_CLAUDE_DELAY_MS: "20000" }, async () => {
      await t.api("POST", `/api/concept-sets/${set.id}/start`);
      await until(() => getSet(t, set.id), (s) => s.concepts.every((c) => c.state === "designing"));
      assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/cancel`)).status, 200);
      const done = await until(() => getSet(t, set.id), finished, 15_000);
      assert.equal(done.state, "cancelled");
      assert.deepEqual(done.concepts.map((c) => c.state), ["cancelled", "cancelled", "cancelled"]);
      assert.ok(done.concepts.every((c) => !c.running));
    });
    // A draft can be cancelled too.
    const draft = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 2, brief: {} })).body;
    assert.equal((await t.api("POST", `/api/concept-sets/${draft.id}/cancel`)).body.state, "cancelled");
  } finally {
    await t.close();
  }
});

test("another concept adds one with an unused archetype and the others as siblings", async () => {
  const { t, kit, argsFile } = await setup();
  try {
    const set = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 2, brief: {} })).body;
    assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/another`)).status, 409, "not while it is a draft");
    await withEnv({ FAKE_CLAUDE_ARGS_OUT: argsFile }, async () => {
      await t.api("POST", `/api/concept-sets/${set.id}/start`);
      const first = await until(() => getSet(t, set.id), finished);
      const used = first.concepts.map((c) => c.archetype);
      const added = await t.api("POST", `/api/concept-sets/${set.id}/another`);
      assert.equal(added.status, 202);
      assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/another`)).status, 409, "one at a time");
      const done = await until(() => getSet(t, set.id), (s) => finished(s) && s.concepts.length === 3);
      assert.equal(done.concepts[2].state, "done");
      assert.ok(!used.includes(done.concepts[2].archetype));
      assert.equal(done.concepts.length, 3);
      const project = (await t.api("GET", `/api/projects/${done.concepts[2].projectId}`)).body;
      assert.equal(project.conceptSet.index, 2);
      assert.ok(project.assets.some((a) => a.name === "kit-f01.jpg"), "kit material was copied");
      assert.ok(project.assets.some((a) => a.name === "kit-contact-sheet.png") === (await rendererReady(t)));
      const last = readCalls(argsFile).filter((c) => /Your concept/.test(c.systemPrompt ?? "")).at(-1);
      assert.equal((last.systemPrompt.match(/^Concept \d$/gm) ?? []).length, 2, "the two existing concepts are its siblings");
      for (const a of used) assert.ok(last.systemPrompt.includes(`Archetype: ${a}`));
    });
    // Every archetype used: no more.
    const full = await Promise.resolve(getSet(t, set.id));
    assert.equal(full.concepts.length, 3);
  } finally {
    await t.close();
  }
});

test("a set's progress arrives over SSE", async () => {
  const { t, kit } = await setup();
  try {
    const set = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 2, brief: {} })).body;
    const controller = new AbortController();
    const res = await fetch(`${t.base}/api/concept-sets/${set.id}/events`, { signal: controller.signal });
    const seen = [];
    const reading = (async () => {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (name) seen.push({ name, data: JSON.parse(data) });
          if (name === "set" && JSON.parse(data).state === "done") return;
        }
      }
    })().catch(() => {});
    await t.api("POST", `/api/concept-sets/${set.id}/start`);
    await Promise.race([reading, sleep(60_000)]);
    controller.abort();
    assert.equal(seen[0].name, "snapshot");
    assert.equal(seen[0].data.set.state, "draft");
    const states = seen.filter((e) => e.name === "set").map((e) => e.data.state);
    assert.ok(states.includes("designing"));
    assert.equal(states.at(-1), "done");
    assert.ok(seen.some((e) => e.name === "concept.progress" && typeof e.data.index === "number"));
  } finally {
    await t.close();
  }
});

test("Test & Compare: a zip of 3840x2160 JPGs, each under 2 MB", async (ctx) => {
  const { t, kit } = await setup();
  try {
    if (!(await rendererReady(t))) return ctx.skip("renderer not installed");
    const set = (await t.api("POST", "/api/concept-sets", { kit: kit.id, count: 3, brief: {} })).body;
    assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/test-compare`, {})).status, 409, "nothing rendered yet");
    await t.api("POST", `/api/concept-sets/${set.id}/start`);
    const done = await until(() => getSet(t, set.id), finished);
    assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/test-compare`, { projects: ["x".repeat(3)] })).status, 409);
    assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/test-compare`, { projects: "all" })).status, 400);
    const res = await t.api("POST", `/api/concept-sets/${set.id}/test-compare`, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.files.length, 3);
    for (const f of res.body.files) {
      assert.deepEqual([f.width, f.height], [3840, 2160]);
      assert.ok(f.bytes < 2_000_000, `${f.name} ${f.bytes}`);
    }
    const zip = await fetch(t.base + res.body.url);
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get("content-type"), "application/zip");
    assert.match(zip.headers.get("content-disposition"), /^attachment/);
    assert.equal(zip.headers.get("x-content-type-options"), "nosniff");
    const entries = unzip(Buffer.from(await zip.arrayBuffer()));
    assert.equal(entries.length, 3);
    for (const e of entries) {
      assert.match(e.name, /^thumbnail-\d-[A-Za-z0-9-]+\.jpg$/);
      assert.ok(e.data.length < 2_000_000);
      const info = imageInfo(e.data);
      assert.deepEqual([info.type, info.width, info.height], ["jpeg", 3840, 2160]);
    }
    // Four concepts: YouTube takes three, so the owner must choose.
    await t.api("POST", `/api/concept-sets/${set.id}/another`);
    const four = await until(() => getSet(t, set.id), (s) => finished(s) && s.concepts.length === 4);
    assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/test-compare`, {})).status, 400);
    const chosen = four.concepts.slice(1).map((c) => c.projectId);
    assert.equal((await t.api("POST", `/api/concept-sets/${set.id}/test-compare`, { projects: chosen })).body.files.length, 3);
    void done;
  } finally {
    await t.close();
  }
});

test("platform covers: Shorts 2160x3840, Reels and TikTok 1080x1920, one JPG or a zip", async (ctx) => {
  const { t, kit } = await setup();
  try {
    if (!(await rendererReady(t))) return ctx.skip("renderer not installed");
    const wide = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "x" } })).body;
    assert.equal((await t.api("POST", `/api/projects/${wide.id}/platform-export`, {})).status, 400, "16:9 is not a cover");
    const p = (await t.api("POST", "/api/projects", { preset: "thumbnail", kit: kit.id, brief: { format: "shorts", platforms: ["youtube-shorts", "instagram-reels", "tiktok"] } })).body;
    assert.equal((await t.api("POST", `/api/projects/${p.id}/platform-export`, {})).status, 409, "no render yet");
    await t.api("POST", `/api/projects/${p.id}/messages`, { text: "go" });
    await until(async () => (await t.api("GET", `/api/projects/${p.id}`)).body, (x) => x.current >= 1 && !x.running);
    assert.equal((await t.api("POST", `/api/projects/${p.id}/platform-export`, { platforms: ["myspace"] })).status, 400);
    assert.equal((await t.api("POST", `/api/projects/${p.id}/platform-export`, { platforms: [] })).status, 400);

    const yt = await t.api("POST", `/api/projects/${p.id}/platform-export`, { platforms: ["youtube-shorts"] });
    assert.equal(yt.status, 200, JSON.stringify(yt.body));
    assert.deepEqual([yt.body.width, yt.body.height], [2160, 3840]);
    assert.ok(yt.body.bytes < 2_000_000);
    assert.match(yt.body.url, /\.jpg$/);
    const jpg = Buffer.from(await (await fetch(t.base + yt.body.url)).arrayBuffer());
    assert.deepEqual([imageInfo(jpg).type, imageInfo(jpg).width, imageInfo(jpg).height], ["jpeg", 2160, 3840]);

    const reels = await t.api("POST", `/api/projects/${p.id}/platform-export`, { platforms: ["instagram-reels"] });
    assert.deepEqual([reels.body.width, reels.body.height], [1080, 1920]);
    const tiktok = await t.api("POST", `/api/projects/${p.id}/platform-export`, { platforms: ["tiktok"] });
    assert.deepEqual([tiktok.body.width, tiktok.body.height], [1080, 1920]);

    // Default: the brief's platforms, all three, as a zip.
    const all = await t.api("POST", `/api/projects/${p.id}/platform-export`, {});
    assert.match(all.body.url, /\.zip$/);
    const zip = await fetch(t.base + all.body.url);
    assert.equal(zip.headers.get("content-type"), "application/zip");
    const entries = unzip(Buffer.from(await zip.arrayBuffer()));
    assert.deepEqual(entries.map((e) => e.name).sort(), ["instagram-reels-1080x1920.jpg", "tiktok-1080x1920.jpg", "youtube-shorts-2160x3840.jpg"]);
    for (const e of entries) assert.ok(e.data.length < 2_000_000);
    // Only the brief's platforms when it lists some.
    const mine = (await t.api("POST", "/api/projects", { preset: "thumbnail", brief: { title: "y", format: "shorts", platforms: ["tiktok"] } })).body;
    fs.copyFileSync(path.join(t.config.projectsDir, p.id, "design.html"), path.join(t.config.projectsDir, mine.id, "design.html"));
    await t.app.store.mutate(mine.id, (x) => void (x.current = 1));
    const one = await t.api("POST", `/api/projects/${mine.id}/platform-export`, {});
    assert.equal(one.status, 200);
    assert.equal(one.body.files.length, 1);
    assert.equal(one.body.files[0].platform, "tiktok");
  } finally {
    await t.close();
  }
});

test("a JPEG that is over budget is re-encoded at lower quality until it fits", async (ctx) => {
  const t = await startApp();
  try {
    if (!(await rendererReady(t))) return ctx.skip("renderer not installed");
    const dir = tempDir();
    // Fine noise does not compress: far over a small budget at the default quality.
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;width:640px;height:360px;overflow:hidden}</style></head><body><svg width="640" height="360"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" seed="3"/></filter><rect width="640" height="360" filter="url(#n)"/></svg></body></html>`;
    fs.writeFileSync(path.join(dir, "d.html"), html);
    const render = (extra) => renderHtml(t.config, { htmlFile: path.join(dir, "d.html"), width: 640, height: 360, scale: 2, format: "jpg", out: path.join(dir, "o.jpg"), ...extra });
    const plain = await render({});
    assert.equal(plain.quality, 92);
    const budget = Math.round(plain.bytes * 0.5);
    const fitted = await render({ maxBytes: budget });
    assert.ok(fitted.quality < 92, `quality ${fitted.quality}`);
    assert.ok(fitted.bytes <= budget, `${fitted.bytes} <= ${budget}`);
    assert.equal(fs.statSync(path.join(dir, "o.jpg")).size, fitted.bytes);
    assert.equal((await render({ quality: 50 })).quality, 50);
    const hopeless = await render({ maxBytes: 100 });
    assert.equal(hopeless.quality, 40, "never below the floor");
  } finally {
    await t.close();
  }
});
