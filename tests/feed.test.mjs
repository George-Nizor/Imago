import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { feedBody, surfaceHtml, SURFACES } from "../server/feed-markup.mjs";
import { formatOf, libraryNeighbours, stageFeed } from "../server/feed.mjs";
import { loadConfig } from "../server/config.mjs";
import { seedProject, tempDir } from "./helpers.mjs";

test("formatOf prefers the brief and falls back to the canvas shape", () => {
  assert.equal(formatOf({ brief: { format: "shorts" }, size: { width: 1280, height: 720 } }), "shorts");
  assert.equal(formatOf({ brief: {}, size: { width: 1280, height: 720 } }), "video");
  assert.equal(formatOf({ brief: {}, size: { width: 720, height: 1280 } }), "shorts");
  assert.equal(formatOf({ brief: {}, size: { width: 1280, height: 1280 } }), "podcast");
});

test("neighbours: same shape, newest first, never this project or its concept set", async () => {
  const projectsDir = path.join(tempDir(), "projects");
  seedProject(projectsDir, "me-aaaa", { conceptSet: { id: "set-1" } });
  seedProject(projectsDir, "sibling-bbbb", { conceptSet: { id: "set-1" }, updatedAt: "2026-03-01T00:00:00Z" });
  seedProject(projectsDir, "older-cccc", { updatedAt: "2026-01-01T00:00:00Z" });
  seedProject(projectsDir, "newer-dddd", { updatedAt: "2026-02-01T00:00:00Z" });
  seedProject(projectsDir, "tall-eeee", { size: { width: 720, height: 1280 } });
  seedProject(projectsDir, "photo-ffff", { preset: "photo" });
  seedProject(projectsDir, "norender-gggg", { current: 7 });
  const found = await libraryNeighbours({ projectsDir, projectId: "me-aaaa", conceptSetId: "set-1", format: "video" });
  assert.deepEqual(found.map((n) => n.id), ["newer-dddd", "older-cccc"]);
  const without = await libraryNeighbours({ projectsDir, projectId: "me-aaaa", conceptSetId: null, format: "video" });
  assert.equal(without[0].id, "sibling-bbbb");
  assert.deepEqual((await libraryNeighbours({ projectsDir: path.join(projectsDir, "nope"), projectId: "x", format: "video" })), []);
});

test("every string in the mock-up is escaped", () => {
  const evil = `<img src=x onerror=alert(1)>"&'`;
  const mine = { src: "thumb.png", title: evil, channel: evil, views: evil, age: evil, duration: evil };
  const others = [{ src: "n0.png", title: evil, channel: evil, views: evil, age: evil, duration: evil }];
  for (const format of ["video", "shorts", "podcast"]) {
    const html = feedBody(format, mine, others);
    assert.ok(!html.includes("<img src=x"), `${format}: raw markup leaked`);
    assert.ok(!html.includes('onerror=alert(1)>"'), format);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    for (const s of SURFACES[format]) assert.ok(surfaceHtml(s.id, mine, others).length > 100, s.id);
  }
});

test("staging copies what the page needs into a temp folder and cleans it up", async () => {
  const dataDir = tempDir();
  const projectsDir = path.join(dataDir, "projects");
  seedProject(projectsDir, "other-hhhh");
  const config = loadConfig({}, { dataDir });
  const staged = await stageFeed({ config, format: "video", title: "A <b>title</b>", projectId: "me-aaaa", outFile: path.join(dataDir, "feed.png") });
  const files = fs.readdirSync(staged.dir);
  assert.ok(files.includes("index.html") && files.includes("job.json") && files.includes("n0.png"));
  assert.equal(staged.source, "library");
  const html = fs.readFileSync(path.join(staged.dir, "index.html"), "utf8");
  assert.ok(!html.includes("<b>title</b>"));
  await staged.cleanup();
  assert.equal(fs.existsSync(staged.dir), false);
  const bare = await stageFeed({ config: loadConfig({}, { dataDir: tempDir() }), format: "shorts", title: "", projectId: "x", outFile: "/dev/null" });
  assert.equal(bare.source, "decoys");
  await bare.cleanup();
});
