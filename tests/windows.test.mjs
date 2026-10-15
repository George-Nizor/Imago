// The Windows rules, checked on any machine: the file system and environment are passed in.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeBin, findClaudeWindows } from "../server/claude-bin.mjs";
import { rename } from "../server/fs-retry.mjs";
import { bringOverFromWsl, findWslData, wslDistros } from "../server/migrate-wsl.mjs";
import { electronFlags } from "../server/renderer.mjs";
import { defaultDataDir, fabulaRoots } from "../server/config.mjs";

const only = (...files) => (file) => files.map((f) => f.toLowerCase()).includes(file.toLowerCase());

test("Windows: claude.exe from the native installer comes before PATH and npm", () => {
  const env = { USERPROFILE: "C:\\Users\\me", PATH: "C:\\tools;C:\\npm" };
  const found = findClaudeWindows({ env, exists: only("C:\\Users\\me\\.local\\bin\\claude.exe", "C:\\tools\\claude.exe") });
  assert.equal(found, "C:\\Users\\me\\.local\\bin\\claude.exe");
});

test("Windows: claude.exe on PATH, then the program inside npm's package, never the .cmd", () => {
  const env = { USERPROFILE: "C:\\Users\\me", Path: "C:\\tools;C:\\npm" };
  assert.equal(findClaudeWindows({ env, exists: only("C:\\tools\\claude.exe") }), "C:\\tools\\claude.exe");
  const npm = "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe";
  assert.equal(findClaudeWindows({ env, exists: only("C:\\npm\\claude.cmd", npm) }), npm);
  const roaming = { USERPROFILE: "C:\\Users\\me", APPDATA: "C:\\Users\\me\\AppData\\Roaming", PATH: "" };
  const global = "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe";
  assert.equal(findClaudeWindows({ env: roaming, exists: only(global) }), global);
  assert.equal(findClaudeWindows({ env, exists: only("C:\\npm\\claude.cmd") }), null);
});

test("Windows: IMAGO_CLAUDE_BIN wins when it exists", () => {
  const env = { IMAGO_CLAUDE_BIN: "D:\\claude.exe", USERPROFILE: "C:\\Users\\me" };
  assert.equal(findClaudeWindows({ env, exists: only("D:\\claude.exe", "C:\\Users\\me\\.local\\bin\\claude.exe") }), "D:\\claude.exe");
});

test("Linux: claude from PATH, a relative IMAGO_CLAUDE_BIN pinned to the working folder", () => {
  assert.equal(claudeBin({}, "linux"), "claude");
  assert.equal(claudeBin({ IMAGO_CLAUDE_BIN: "tests/fake" }, "linux"), path.resolve("tests/fake"));
});

test("a rename refused for a moment on Windows is tried again; elsewhere and for real errors it is not", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("busy"), { code: "EPERM" });
  };
  await rename("a", "b", { rename: flaky, platform: "win32", delayMs: 1 });
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(rename("a", "b", { rename: flaky, platform: "linux", delayMs: 1 }), /busy/);
  assert.equal(calls, 1);
  const missing = async () => {
    calls += 1;
    throw Object.assign(new Error("gone"), { code: "ENOENT" });
  };
  calls = 0;
  await assert.rejects(rename("a", "b", { rename: missing, platform: "win32", delayMs: 1 }), /gone/);
  assert.equal(calls, 1);
});

test("Electron switches: no zygote, shm or ozone on Windows", () => {
  assert.deepEqual(electronFlags("win32"), ["--no-sandbox", "--disable-gpu"]);
  assert.ok(electronFlags("linux").includes("--no-zygote"));
  assert.ok(electronFlags("linux").includes("--ozone-platform=headless"));
});

test("Windows data lives in %LOCALAPPDATA%\\Imago unless IMAGO_DATA_DIR names a folder", () => {
  assert.equal(defaultDataDir({ LOCALAPPDATA: "C:/Users/me/AppData/Local" }, "win32"), path.join("C:/Users/me/AppData/Local", "Imago"));
  assert.equal(defaultDataDir({ IMAGO_DATA_DIR: "/tmp/x" }, "win32"), "/tmp/x");
  assert.match(defaultDataDir({}, "linux"), /\.local\/share\/imago$/);
});

test("Windows Fabula kits come from Fabula's own settings, else Videos\\Fabula", async () => {
  const local = await fs.mkdtemp(path.join(os.tmpdir(), "imago-win-"));
  try {
    const env = { LOCALAPPDATA: local, USERPROFILE: "C:/Users/me" };
    assert.equal(fabulaRoots(env, "win32")[0], path.join("C:/Users/me", "Videos", "Fabula"));
    await fs.mkdir(path.join(local, "Fabula", "engine"), { recursive: true });
    await fs.writeFile(path.join(local, "Fabula", "engine", "settings.json"), JSON.stringify({ projectsRoot: "E:\\Films" }));
    assert.equal(fabulaRoots(env, "win32")[0], "E:\\Films");
  } finally {
    await fs.rm(local, { recursive: true, force: true });
  }
});

test("WSL distributions are read in UTF-16 or UTF-8", () => {
  const utf16 = Buffer.from("Ubuntu\r\ndocker-desktop\r\n", "utf16le");
  assert.deepEqual(wslDistros(() => ({ status: 0, stdout: utf16 })), ["Ubuntu", "docker-desktop"]);
  assert.deepEqual(wslDistros(() => ({ status: 0, stdout: Buffer.from("Ubuntu\n") })), ["Ubuntu"]);
  assert.deepEqual(wslDistros(() => ({ status: 1, stdout: null })), []);
});

test("the WSL data folder is the first non-empty ~/.local/share/imago", () => {
  const tree = {
    "\\\\wsl.localhost\\Ubuntu\\home": ["me"],
    "\\\\wsl.localhost\\Ubuntu\\home\\me\\.local\\share\\imago": ["projects"],
  };
  const readdir = (dir) => {
    if (!(dir in tree)) throw new Error("ENOENT");
    return tree[dir];
  };
  assert.equal(findWslData({ distros: ["docker-desktop", "Ubuntu"], readdir, isDir: (dir) => dir in tree }), "\\\\wsl.localhost\\Ubuntu\\home\\me\\.local\\share\\imago");
  assert.equal(findWslData({ distros: [], readdir, isDir: () => true }), null);
});

test("bringing data over copies once, keeps timestamps and never touches an existing folder", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-move-"));
  try {
    const from = path.join(root, "wsl");
    const to = path.join(root, "Imago");
    await fs.mkdir(path.join(from, "projects", "p1"), { recursive: true });
    await fs.writeFile(path.join(from, "projects", "p1", "project.json"), "{}");
    const old = new Date("2026-10-01T10:00:00Z");
    await fs.utimes(path.join(from, "projects", "p1", "project.json"), old, old);
    const said = [];
    assert.deepEqual(await bringOverFromWsl({ to, from, say: (line) => said.push(line) }), { copied: true, from });
    const stat = await fs.stat(path.join(to, "projects", "p1", "project.json"));
    assert.equal(stat.mtime.getTime(), old.getTime());
    await fs.access(`${to}.incoming`).then(() => assert.fail("staging folder left behind"), () => {});
    assert.deepEqual(await bringOverFromWsl({ to, from, say: () => {} }), { copied: false });
    await fs.access(path.join(from, "projects", "p1", "project.json"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
