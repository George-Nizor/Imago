import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { crc32 } from "../server/zip.mjs";
import { eventsDuring, makePng, startApp } from "./helpers.mjs";

const done = (e) => e.event === "run.finished" || e.event === "run.error";

/** A project with a fake render and design, as if a turn had finished. */
async function seed(t, { title, preset = "thumbnail", brief, createdAt, updatedAt, render = true, color }) {
  const defaults = { thumbnail: { title: title, format: "video" }, graphic: { description: title }, photo: { instruction: title } };
  const size = preset === "thumbnail" ? { width: 1280, height: 720 } : { width: 640, height: 480 };
  const p = await t.app.store.create({ preset, title, size, brief: brief ?? defaults[preset] });
  const dir = t.app.store.dirOf(p.id);
  if (render) {
    fs.writeFileSync(path.join(dir, "renders", "v1.png"), makePng(16, 9, color));
    fs.writeFileSync(path.join(dir, "versions", "v1.html"), "<html></html>");
    fs.writeFileSync(path.join(dir, "design.html"), `<html><body>${title}</body></html>`);
  }
  await t.app.store.mutate(
    p.id,
    (x) => {
      if (render) {
        x.versions.push({ n: 1, at: "2026-01-01T00:00:00Z", warnings: [] });
        x.current = 1;
      }
      if (createdAt) x.createdAt = createdAt;
      if (updatedAt) x.updatedAt = updatedAt;
    },
    { touch: false },
  );
  return p.id;
}

const day = (n) => `2026-02-${String(n).padStart(2, "0")}T10:00:00.000Z`;

/** Reads a store-only zip: [{name, data}], checking each entry's crc and the central directory. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end of central directory");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("ascii", at + 46, at + 46 + nameLen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    assert.equal(buf.readUInt16LE(local + 8), 0, "stored, not deflated");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    entries.push({ name, data });
    at += 46 + nameLen;
  }
  return entries;
}

test("list: filter, search, sort and paginate compact summaries", async () => {
  const t = await startApp();
  try {
    const ids = [];
    for (let i = 1; i <= 12; i += 1) {
      ids.push(await seed(t, { title: `Episode ${String(i).padStart(2, "0")}`, preset: i % 3 === 0 ? "graphic" : "thumbnail", createdAt: day(i), updatedAt: day(13 - i), render: i !== 5 }));
    }
    await seed(t, { title: "Zebra", brief: { title: "Rockets over the desert", notes: "teal" }, createdAt: day(20), updatedAt: day(1) });
    const list = async (q) => (await t.api("GET", `/api/projects${q}`)).body;

    const all = await list("");
    assert.equal(all.total, 13);
    assert.equal(all.items[0].id, ids[0]); // edited sort: i=1 has the newest updatedAt
    // Summaries are compact: no conversation, no search text.
    assert.deepEqual(Object.keys(all.items[0]).sort(), ["createdAt", "current", "id", "preset", "series", "size", "starred", "thumbnail", "title", "updatedAt", "versionCount"]);
    assert.equal(all.items[0].thumbnail, `/projects/${ids[0]}/renders/v1.png`);
    assert.equal(all.items[0].versionCount, 1);
    assert.equal(all.items.find((p) => p.id === ids[4]).thumbnail, null);

    assert.deepEqual((await list("?sort=newest")).items.slice(0, 2).map((p) => p.title), ["Zebra", "Episode 12"]);
    assert.deepEqual((await list("?sort=oldest&limit=2")).items.map((p) => p.title), ["Episode 01", "Episode 02"]);
    assert.deepEqual((await list("?sort=title&limit=2")).items.map((p) => p.title), ["Episode 01", "Episode 02"]);
    assert.equal((await list("?sort=title&limit=1&offset=12")).items[0].title, "Zebra");

    const page = await list("?sort=oldest&limit=5&offset=10");
    assert.equal(page.total, 13);
    assert.equal(page.items.length, 3);
    assert.equal((await list("?limit=0")).items.length, 1, "limit is clamped to at least 1");
    assert.equal((await list("")).items.length, 13, "the default page is 40");

    assert.equal((await list("?preset=graphic")).total, 4);
    // Search covers the title and the brief, every word must match, case does not matter.
    assert.deepEqual((await list("?query=ROCKETS%20desert")).items.map((p) => p.title), ["Zebra"]);
    assert.deepEqual((await list("?query=teal")).items.map((p) => p.title), ["Zebra"]);
    assert.equal((await list("?query=episode%2007")).total, 1);
    assert.equal((await list("?query=nothing-like-this")).total, 0);

    await t.api("PATCH", `/api/projects/${ids[2]}`, { starred: true });
    await t.api("PATCH", `/api/projects/${ids[3]}`, { starred: true });
    assert.deepEqual((await list("?starred=1&sort=title")).items.map((p) => p.title), ["Episode 03", "Episode 04"]);
    assert.equal((await list("?starred=1&preset=graphic")).total, 1);
    const s = (await t.api("POST", "/api/series", { name: "Rocket Channel" })).body;
    await t.api("POST", "/api/projects/bulk", { action: "series", ids: [ids[0], ids[1]], series: s.id });
    assert.equal((await list(`?series=${s.id}`)).total, 2);
    assert.equal((await list("?series=none")).total, 11);
    assert.equal((await list(`?series=${s.id}&starred=1`)).total, 0);

    // A pre-library project.json (no series, no starred, no createdAt) still lists.
    const old = await seed(t, { title: "Old one" });
    const file = path.join(t.app.store.dirOf(old), "project.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const key of ["series", "starred", "createdAt"]) delete raw[key];
    fs.writeFileSync(file, JSON.stringify(raw));
    const legacy = (await list("?query=old%20one")).items[0];
    assert.equal(legacy.starred, false);
    assert.equal(legacy.series, null);
  } finally {
    await t.close();
  }
});

test("patch: rename, star, series; validation; the edit time is left alone", async () => {
  const t = await startApp();
  try {
    const id = await seed(t, { title: "First", updatedAt: day(3) });
    const s = (await t.api("POST", "/api/series", { name: "Channel" })).body;
    const ok = await t.api("PATCH", `/api/projects/${id}`, { title: "  Renamed  ", starred: true, series: s.id });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.title, "Renamed");
    assert.equal(ok.body.starred, true);
    assert.equal(ok.body.series, s.id);
    assert.equal(ok.body.updatedAt, day(3), "renaming is not an edit of the design");
    assert.equal((await t.api("PATCH", `/api/projects/${id}`, { series: null })).body.series, null);
    for (const bad of [{ title: "   " }, { starred: "yes" }, { series: "nope-series" }, { series: 7 }]) {
      assert.equal((await t.api("PATCH", `/api/projects/${id}`, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await t.api("PATCH", "/api/projects/missing-0000", { starred: true })).status, 404);
    assert.equal((await t.api("GET", `/api/projects/${id}`)).body.title, "Renamed");
  } finally {
    await t.close();
  }
});

test("duplicate: an independent copy with no session, versions and assets included", async () => {
  const t = await startApp();
  try {
    const id = await seed(t, { title: "Original" });
    const dir = t.app.store.dirOf(id);
    fs.writeFileSync(path.join(dir, "assets", "face.png"), makePng(4, 4));
    await t.app.store.mutate(id, (p) => {
      p.sessionId = "sess-1";
      p.briefSent = true;
      p.starred = true;
      p.messages.push({ role: "user", text: "hello", at: "t", version: null });
      p.assets.push({ name: "face.png", kind: "upload", width: 4, height: 4, from: null });
    });
    const res = await t.api("POST", `/api/projects/${id}/duplicate`);
    assert.equal(res.status, 201);
    const copy = res.body;
    assert.notEqual(copy.id, id);
    assert.equal(copy.title, "Original (copy)");
    assert.equal(copy.sessionId, null);
    assert.equal(copy.briefSent, false);
    assert.equal(copy.starred, false);
    assert.equal(copy.running, false);
    assert.equal(copy.current, 1);
    assert.equal(copy.messages.length, 1);
    const copyDir = t.app.store.dirOf(copy.id);
    for (const f of ["design.html", "versions/v1.html", "renders/v1.png", "assets/face.png"]) assert.ok(fs.existsSync(path.join(copyDir, f)), f);

    // Independent: changing one does not touch the other.
    fs.writeFileSync(path.join(copyDir, "design.html"), "changed");
    await t.api("PATCH", `/api/projects/${copy.id}`, { title: "Other" });
    assert.match(fs.readFileSync(path.join(dir, "design.html"), "utf8"), /Original/);
    assert.equal((await t.api("GET", `/api/projects/${id}`)).body.title, "Original");
    assert.equal((await t.api("GET", `/api/projects/${id}`)).body.sessionId, "sess-1");
    // A copy of a copy does not stack the suffix.
    assert.equal((await t.api("POST", `/api/projects/${copy.id}/duplicate`)).body.title, "Other (copy)");
    const again = await t.api("POST", `/api/projects/${id}/duplicate`);
    assert.equal(again.body.title, "Original (copy)");
    assert.equal((await t.api("POST", "/api/projects/nope-0000/duplicate")).status, 404);
  } finally {
    await t.close();
  }
});

test("a duplicate's first turn says design.html already holds the duplicated design", async (ctx) => {
  const out = path.join(await fs.promises.mkdtemp(path.join((await import("node:os")).tmpdir(), "imago-dup-")), "calls.jsonl");
  process.env.FAKE_CLAUDE_ARGS_OUT = out;
  const t = await startApp();
  try {
    const caps = (await t.api("GET", "/api/capabilities")).body;
    if (caps.renderer.state !== "ready") return ctx.skip(`renderer not ready: ${caps.renderer.reason}`);
    const id = await seed(t, { title: "Original" });
    await t.app.store.mutate(id, (p) => {
      p.sessionId = "sess-1";
      p.messages.push({ role: "user", text: "Make the headline bigger", at: "t", version: null }, { role: "assistant", text: "Done, bigger headline.", at: "t", version: 1 });
    });
    const copy = (await t.api("POST", `/api/projects/${id}/duplicate`)).body;
    await eventsDuring(t.base, copy.id, () => t.api("POST", `/api/projects/${copy.id}/messages`, { text: "Now make it blue" }), done);
    const call = JSON.parse(fs.readFileSync(out, "utf8").trim().split("\n")[0]);
    assert.ok(!call.argv.includes("--resume"), "a duplicate starts a fresh conversation");
    assert.match(call.stdin, /duplicate of an earlier one/);
    assert.match(call.stdin, /design\.html already holds the duplicated design/);
    assert.match(call.stdin, /Make the headline bigger/);
    assert.match(call.stdin, /Now make it blue/);
    const after = (await t.api("GET", `/api/projects/${copy.id}`)).body;
    assert.equal(after.briefSent, true);
    assert.equal(after.sessionId, "fake-session-1");
  } finally {
    delete process.env.FAKE_CLAUDE_ARGS_OUT;
    await t.close();
  }
});

test("new in this style: reference files, series, and the series section in the system prompt", async (ctx) => {
  const out = path.join(await fs.promises.mkdtemp(path.join((await import("node:os")).tmpdir(), "imago-style-")), "calls.jsonl");
  process.env.FAKE_CLAUDE_ARGS_OUT = out;
  const t = await startApp();
  try {
    const source = await seed(t, { title: "Rocket Channel", color: [10, 120, 200] });
    await t.app.store.mutate(source, (p) => void Object.assign(p.brief, { channelColours: "teal", title: "Episode one", notes: "Episode 1 only: BUILD #1 badge." }));
    assert.equal((await t.api("POST", "/api/projects/nope-0000/new-in-style", {})).status, 404);
    const unrendered = await seed(t, { title: "Blank", render: false });
    assert.equal((await t.api("POST", `/api/projects/${unrendered}/new-in-style`, {})).status, 409);
    assert.equal((await t.api("GET", "/api/series")).body.length, 0, "a refused request leaves no series behind");

    const res = await t.api("POST", `/api/projects/${source}/new-in-style`, { brief: { title: "Episode two" }, title: "Episode two" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const next = res.body;
    assert.equal(next.preset, "thumbnail");
    assert.deepEqual(next.size, { width: 1280, height: 720 });
    assert.equal(next.title, "Episode two");
    assert.equal(next.brief.title, "Episode two");
    assert.equal(next.brief.channelColours, "teal", "channel fields carry over");
    assert.equal(next.brief.notes, "", "episode notes do not carry over");
    assert.equal(next.brief.format, "video");
    assert.equal(next.sessionId, null);

    const series = (await t.api("GET", "/api/series")).body;
    assert.equal(series.length, 1);
    assert.equal(series[0].name, "Rocket Channel");
    assert.equal(series[0].styleProjectId, source);
    assert.equal(series[0].count, 2);
    assert.equal(next.series, series[0].id);
    assert.equal((await t.api("GET", `/api/projects/${source}`)).body.series, series[0].id);

    const dir = t.app.store.dirOf(next.id);
    assert.deepEqual(fs.readFileSync(path.join(dir, "assets", "style-reference.png")), fs.readFileSync(path.join(t.app.store.dirOf(source), "renders", "v1.png")));
    assert.match(fs.readFileSync(path.join(dir, "reference", "style-reference.html"), "utf8"), /Rocket Channel/);
    assert.ok(next.assets.some((a) => a.name === "style-reference.png" && a.kind === "reference"));

    // The reference HTML is never served; its image is an ordinary asset.
    assert.equal((await fetch(`${t.base}/projects/${next.id}/reference/style-reference.html`)).status, 404);
    assert.equal((await fetch(`${t.base}/projects/${next.id}/assets/style-reference.png`)).status, 200);

    // A second one reuses the series rather than making another.
    const third = (await t.api("POST", `/api/projects/${source}/new-in-style`, {})).body;
    assert.equal(third.series, series[0].id);
    assert.equal((await t.api("GET", "/api/series")).body.length, 1);

    const caps = (await t.api("GET", "/api/capabilities")).body;
    if (caps.renderer.state !== "ready") return ctx.skip(`renderer not ready: ${caps.renderer.reason}`);
    await eventsDuring(t.base, next.id, () => t.api("POST", `/api/projects/${next.id}/messages`, { text: "Make the thumbnail" }), done);
    const call = JSON.parse(fs.readFileSync(out, "utf8").trim().split("\n")[0]);
    assert.match(call.systemPrompt, /## Series style/);
    assert.match(call.systemPrompt, /"Rocket Channel"/);
    assert.match(call.systemPrompt, /reference\/style-reference\.html/);
    assert.match(call.systemPrompt, /Change only the content/);
    // A project outside a series gets no such section.
    const plain = await seed(t, { title: "Plain" });
    await eventsDuring(t.base, plain, () => t.api("POST", `/api/projects/${plain}/messages`, { text: "Go" }), done);
    const last = JSON.parse(fs.readFileSync(out, "utf8").trim().split("\n").at(-1));
    assert.ok(!last.systemPrompt.includes("## Series style"));
  } finally {
    delete process.env.FAKE_CLAUDE_ARGS_OUT;
    await t.close();
  }
});

test("joining a series that has a style project brings its reference along", async () => {
  const t = await startApp();
  try {
    const source = await seed(t, { title: "Style source" });
    const s = (await t.api("POST", "/api/series", { name: "Channel", styleProjectId: source })).body;
    const other = await seed(t, { title: "Other" });
    await t.api("PATCH", `/api/projects/${other}`, { series: s.id });
    assert.ok(fs.existsSync(path.join(t.app.store.dirOf(other), "reference", "style-reference.html")));
    const made = (await t.api("POST", "/api/projects", { preset: "graphic", brief: { description: "x" }, series: s.id })).body;
    assert.equal(made.series, s.id);
    assert.ok(fs.existsSync(path.join(t.app.store.dirOf(made.id), "reference", "style-reference.html")));
    assert.equal((await t.api("POST", "/api/projects", { preset: "graphic", brief: { description: "x" }, series: "nope" })).status, 400);
  } finally {
    await t.close();
  }
});

test("bulk: star, series, soft delete with undo, and the trash purge", async () => {
  const t = await startApp();
  try {
    const [a, b, c] = [await seed(t, { title: "A" }), await seed(t, { title: "B" }), await seed(t, { title: "C" })];
    assert.deepEqual((await t.api("POST", "/api/projects/bulk", { action: "star", ids: [a, b, "gone-0000"] })).body, { ok: true, changed: [a, b], missing: ["gone-0000"] });
    assert.equal((await t.api("GET", "/api/projects?starred=1")).body.total, 2);
    await t.api("POST", "/api/projects/bulk", { action: "unstar", ids: [a] });
    assert.equal((await t.api("GET", "/api/projects?starred=1")).body.total, 1);
    const s = (await t.api("POST", "/api/series", { name: "S" })).body;
    await t.api("POST", "/api/projects/bulk", { action: "series", ids: [a, b], series: s.id });
    await t.api("POST", "/api/projects/bulk", { action: "series", ids: [b], series: null });
    assert.equal((await t.api("GET", `/api/projects?series=${s.id}`)).body.total, 1);
    assert.equal((await t.api("POST", "/api/projects/bulk", { action: "series", ids: [a], series: "unknown" })).status, 400);

    const del = await t.api("POST", "/api/projects/bulk", { action: "delete", ids: [a, b] });
    assert.deepEqual(del.body.changed, [a, b]);
    assert.equal((await t.api("GET", `/api/projects/${a}`)).status, 404);
    assert.equal((await t.api("GET", "/api/projects")).body.total, 1);
    assert.ok(fs.existsSync(path.join(t.config.projectsDir, ".trash", a, "project.json")), "kept in the trash");

    const undo = await t.api("POST", "/api/projects/bulk", { action: "restore", ids: [a, b, c] });
    assert.deepEqual(undo.body, { ok: true, changed: [a, b], missing: [c] });
    assert.equal((await t.api("GET", "/api/projects")).body.total, 3);
    assert.equal((await t.api("GET", `/api/projects/${a}`)).body.title, "A");
    assert.ok(fs.existsSync(path.join(t.app.store.dirOf(a), "renders", "v1.png")));

    // Purge: only what has sat in the trash for more than seven days goes.
    await t.api("POST", "/api/projects/bulk", { action: "delete", ids: [a, b] });
    const marker = path.join(t.config.projectsDir, ".trash", `${a}.json`);
    fs.writeFileSync(marker, JSON.stringify({ deletedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }));
    assert.equal(await t.app.store.purgeTrash(), 1);
    assert.equal(fs.existsSync(path.join(t.config.projectsDir, ".trash", a)), false);
    assert.equal(fs.existsSync(path.join(t.config.projectsDir, ".trash", b)), true);
    assert.deepEqual((await t.api("POST", "/api/projects/bulk", { action: "restore", ids: [a] })).body.missing, [a]);
    // Nothing in the trash shows up as a project.
    assert.equal((await t.api("GET", "/api/projects")).body.total, 1);

    for (const bad of [{ action: "nope", ids: [a] }, { action: "delete" }, { action: "delete", ids: [] }, { action: "delete", ids: "x" }, { action: "delete", ids: Array.from({ length: 501 }, (_, i) => `p-${i}`) }]) {
      assert.equal((await t.api("POST", "/api/projects/bulk", bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
  } finally {
    await t.close();
  }
});

test("export.zip: a valid store-only zip of each current render", async () => {
  const t = await startApp();
  try {
    const a = await seed(t, { title: "Rocket: the launch!", color: [255, 0, 0] });
    const b = await seed(t, { title: "Rocket: the launch!", color: [0, 0, 255] });
    const blank = await seed(t, { title: "Blank", render: false });
    const res = await fetch(`${t.base}/api/projects/export.zip?ids=${a},${b},${blank},gone-0000`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.match(res.headers.get("content-disposition"), /^attachment; filename="imago-export\.zip"$/);
    const entries = readZip(Buffer.from(await res.arrayBuffer()));
    assert.equal(entries.length, 2, "projects without a render are skipped");
    assert.deepEqual(entries.map((e) => e.name), [`Rocket-the-launch-${a}-v1.png`, `Rocket-the-launch-${b}-v1.png`]);
    assert.deepEqual(entries[0].data, fs.readFileSync(path.join(t.app.store.dirOf(a), "renders", "v1.png")));
    assert.deepEqual(entries[1].data, fs.readFileSync(path.join(t.app.store.dirOf(b), "renders", "v1.png")));
    assert.equal((await fetch(`${t.base}/api/projects/export.zip?ids=${blank}`)).status, 404);
    assert.equal((await fetch(`${t.base}/api/projects/export.zip`)).status, 400);
    assert.equal((await fetch(`${t.base}/api/projects/export.zip?ids=..%2Fetc`)).status, 400);
  } finally {
    await t.close();
  }
});

test("series CRUD", async () => {
  const t = await startApp();
  try {
    assert.deepEqual((await t.api("GET", "/api/series")).body, []);
    const made = await t.api("POST", "/api/series", { name: "  Rocket   Channel " });
    assert.equal(made.status, 201);
    assert.equal(made.body.name, "Rocket Channel");
    assert.match(made.body.id, /^rocket-channel/);
    assert.ok(made.body.createdAt);
    assert.equal((await t.api("POST", "/api/series", { name: "rocket channel" })).status, 409);
    assert.equal((await t.api("POST", "/api/series", { name: " " })).status, 400);
    assert.equal((await t.api("POST", "/api/series", { name: "X", styleProjectId: "gone-0000" })).status, 400);
    const p = await seed(t, { title: "Member" });
    const style = await seed(t, { title: "Style" });
    await t.api("PATCH", `/api/projects/${p}`, { series: made.body.id });
    const renamed = await t.api("PATCH", `/api/series/${made.body.id}`, { name: "Rockets", styleProjectId: style });
    assert.equal(renamed.body.name, "Rockets");
    assert.equal(renamed.body.styleProjectId, style);
    assert.equal((await t.api("PATCH", `/api/series/${made.body.id}`, { styleProjectId: null })).body.styleProjectId, undefined);
    assert.equal((await t.api("PATCH", "/api/series/nope", { name: "x" })).status, 404);
    assert.equal((await t.api("GET", "/api/series")).body[0].count, 1);
    // On disk, where the contract says.
    assert.equal(JSON.parse(fs.readFileSync(path.join(t.dataDir, "series.json"), "utf8"))[0].name, "Rockets");

    assert.equal((await t.api("DELETE", `/api/series/${made.body.id}`)).status, 200);
    assert.equal((await t.api("DELETE", `/api/series/${made.body.id}`)).status, 404);
    assert.deepEqual((await t.api("GET", "/api/series")).body, []);
    assert.equal((await t.api("GET", `/api/projects/${p}`)).body.series, null, "members leave the series, nothing else is lost");
  } finally {
    await t.close();
  }
});

test("the new routes are path safe and keep the origin and content-type rules", async () => {
  const t = await startApp();
  try {
    const id = await seed(t, { title: "Safe" });
    const raw = (method, url, { body, headers = {} } = {}) => fetch(t.base + url, { method, headers, body });
    for (const url of ["/api/projects/..%2F..%2Fx/duplicate", "/api/projects/..%2Fx/new-in-style", "/api/series/..%2Fx", "/api/projects/%2e%2e"]) {
      const res = await raw(url.startsWith("/api/series") ? "PATCH" : "POST", url, { headers: { "content-type": "application/json" }, body: "{}" });
      assert.ok([400, 404].includes(res.status), `${url} -> ${res.status}`);
    }
    const traversal = await t.api("POST", "/api/projects/bulk", { action: "delete", ids: ["../../etc", id] });
    assert.equal(traversal.status, 400);
    assert.equal((await t.api("GET", `/api/projects/${id}`)).status, 200, "nothing was deleted");
    assert.equal((await t.api("POST", "/api/projects/bulk", { action: "restore", ids: ["..%2f..%2fx"] })).status, 400);
    assert.equal((await t.api("POST", "/api/series", { name: "S", styleProjectId: "../x" })).status, 400);
    // Trash entries cannot be reached as projects or files.
    await t.api("POST", "/api/projects/bulk", { action: "delete", ids: [id] });
    assert.equal((await fetch(`${t.base}/projects/.trash/${id}/project.json`)).status, 400);
    assert.equal((await fetch(`${t.base}/projects/${id}/renders/v1.png`)).status, 404);

    const alive = await seed(t, { title: "Alive" });
    // Origin, fetch-site and content-type rules.
    const json = { "content-type": "application/json" };
    assert.equal((await raw("PATCH", `/api/projects/${alive}`, { headers: { ...json, origin: "http://evil.example" }, body: '{"starred":true}' })).status, 403);
    assert.equal((await raw("POST", `/api/projects/${alive}/duplicate`, { headers: { origin: "http://evil.example" } })).status, 403);
    assert.equal((await raw("POST", "/api/projects/bulk", { headers: { ...json, "sec-fetch-site": "cross-site" }, body: '{"action":"star","ids":["x-1"]}' })).status, 403);
    assert.equal((await raw("POST", "/api/series", { headers: { origin: "http://evil.example", ...json }, body: '{"name":"x"}' })).status, 403);
    assert.equal((await raw("PATCH", `/api/projects/${alive}`, { headers: { "content-type": "text/plain" }, body: '{"starred":true}' })).status, 415);
    assert.equal((await raw("POST", "/api/projects/bulk", { headers: { "content-type": "text/plain" }, body: '{"action":"delete","ids":["x-1"]}' })).status, 415);
    assert.equal((await raw("POST", "/api/series", { headers: { "content-type": "text/plain" }, body: '{"name":"x"}' })).status, 415);
    assert.equal((await t.api("GET", `/api/projects/${alive}`)).body.starred, false);
    assert.equal((await t.api("GET", "/api/series")).body.length, 0);
  } finally {
    await t.close();
  }
});
