import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { StoreError, createStore } from "../server/store.mjs";
import { tempDir } from "./helpers.mjs";

test("create, read, list and delete a project", async () => {
  const dir = tempDir();
  const store = createStore(path.join(dir, "projects"));
  const a = await store.create({ preset: "thumbnail", title: "Rocket Thumbnail!", size: { width: 1280, height: 720 }, brief: { title: "x" } });
  assert.match(a.id, /^rocket-thumbnail-[0-9a-f]{4}$/);
  for (const sub of ["assets", "versions", "renders", "exports"]) assert.ok(fs.statSync(path.join(dir, "projects", a.id, sub)).isDirectory());
  assert.equal(a.schemaVersion, 1);
  assert.equal(a.current, 0);
  assert.equal(a.running, false);
  assert.equal(a.sessionId, null);

  const b = await store.create({ preset: "graphic", title: "", size: { width: 1080, height: 1080 } });
  assert.match(b.id, /^project-[0-9a-f]{4}$/);
  const ids = (await store.list()).map((p) => p.id);
  assert.deepEqual(ids, [b.id, a.id]);

  await store.remove(a.id);
  await assert.rejects(store.read(a.id), (e) => e instanceof StoreError && e.status === 404);
  assert.equal(fs.existsSync(path.join(dir, "projects", a.id)), false);
});

test("mutations are serialised and atomic", async () => {
  const dir = tempDir();
  const store = createStore(path.join(dir, "projects"));
  const p = await store.create({ preset: "graphic", title: "Counter", size: { width: 64, height: 64 } });
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      store.mutate(p.id, async (project) => {
        await new Promise((r) => setTimeout(r, Math.random() * 3));
        project.messages.push({ role: "user", text: String(i), at: "t", version: null });
      }),
    ),
  );
  const after = await store.read(p.id);
  assert.equal(after.messages.length, 25);
  assert.deepEqual(fs.readdirSync(path.join(dir, "projects", p.id)).filter((f) => f.endsWith(".tmp")), []);
});

test("ids are validated and stale running flags are cleared", async () => {
  const dir = tempDir();
  const store = createStore(path.join(dir, "projects"));
  await assert.rejects(store.read("../etc"), (e) => e.code === "BAD_ID");
  const p = await store.create({ preset: "graphic", title: "Stale", size: { width: 64, height: 64 } });
  await store.mutate(p.id, (project) => void (project.running = true));
  await store.clearStaleRunning();
  assert.equal((await store.read(p.id)).running, false);
});
