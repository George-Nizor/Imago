import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { PathError, isProjectId, isSafeLeaf, safeJoin, sanitizeLeaf } from "../server/paths.mjs";
import { startApp } from "./helpers.mjs";

test("safe leaf names", () => {
  for (const ok of ["face.png", "a-b_c.1.webp", "Photo 1.png".replace(" ", "-")]) assert.ok(isSafeLeaf(ok), ok);
  for (const bad of ["", ".hidden", "..", "a/b.png", "a\\b.png", "../x", "a..b.png", "x\0.png", "sp ace.png", 42, null]) assert.ok(!isSafeLeaf(bad), String(bad));
});

test("project ids", () => {
  assert.ok(isProjectId("rocket-thumb-3k9x"));
  for (const bad of ["", "-a", "A", "a/b", "..", "a".repeat(65)]) assert.ok(!isProjectId(bad), bad);
});

test("sanitizeLeaf keeps a usable name and drops directories", () => {
  assert.equal(sanitizeLeaf("C:\\Users\\me\\My Face (1).PNG"), "My-Face-1-.PNG");
  assert.equal(sanitizeLeaf("../../etc/passwd"), "passwd");
  assert.equal(sanitizeLeaf("...", "fallback"), "fallback");
});

test("safeJoin refuses traversal", () => {
  assert.equal(safeJoin("/data", "p1", "design.html"), "/data/p1/design.html");
  assert.throws(() => safeJoin("/data", "..", "x"), PathError);
  assert.throws(() => safeJoin("/data", "a/b"), PathError);
});

test("the server refuses traversal and foreign hosts", async () => {
  const t = await startApp();
  try {
    const { body } = await t.api("POST", "/api/projects", { preset: "graphic", brief: { description: "x" } });
    for (const url of [
      `/projects/${body.id}/assets/..%2F..%2Fproject.json`,
      `/projects/${body.id}/assets/%2e%2e`,
      `/projects/${body.id}/renders/a%5Cb.png`,
      `/fonts/..%2Fpackage.json`,
      `/projects/..%2Fx/design.html`,
    ]) {
      const res = await fetch(t.base + url);
      assert.ok([400, 404].includes(res.status), `${url} -> ${res.status}`);
    }
    // The URL parser normalises "..", so the file is simply not found; it must never be served.
    const raw = await fetch(`${t.base}/projects/${body.id}/assets/../project.json`);
    assert.notEqual(raw.status, 200);
    // A request that reaches the loopback listener under another name is refused.
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`${t.base}/api/health`, { headers: { host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  } finally {
    await t.close();
  }
});
