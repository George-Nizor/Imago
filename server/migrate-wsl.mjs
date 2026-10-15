// Bringing Imago's data over from WSL, once, the first time Imago runs on Windows.
//
// Before 0.3 Imago ran in WSL and kept everything in ~/.local/share/imago: projects, the face pack,
// brands, series and concept sets. On Windows the data is %LOCALAPPDATA%\Imago. When that folder
// does not exist yet and a WSL distribution has the old one, it is copied across through
// \\wsl.localhost (files keep their timestamps; nothing in WSL is changed). Every path inside the
// data is relative to the data folder, so nothing needs rewriting. A Claude session id saved on a
// project belonged to WSL's Claude Code; the first turn finds it gone and starts a new session with
// a recap, as it does whenever a session has vanished.
//
// The copy goes to a sibling folder and is renamed into place when complete, so an interrupted copy
// is started again next time rather than taken for the data.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** WSL distributions by name; none when WSL is not installed. wsl.exe lists in UTF-16 unless WSL_UTF8 is set. */
export function wslDistros(run = spawnSync) {
  const result = run("wsl.exe", ["--list", "--quiet"], { encoding: "buffer", windowsHide: true, timeout: 15_000 });
  if (result.status !== 0 || !result.stdout) return [];
  const text = result.stdout.includes(0) ? result.stdout.toString("utf16le") : result.stdout.toString("utf8");
  return text.replace(/\0/g, "").split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
}

/** The first ~/.local/share/imago found in a WSL distribution, as Windows reaches it, or null. */
export function findWslData({ distros = wslDistros(), readdir = fs.readdirSync, isDir = (dir) => fs.statSync(dir).isDirectory() } = {}) {
  for (const distro of distros) {
    for (const root of ["\\\\wsl.localhost", "\\\\wsl$"]) {
      let users = [];
      try {
        users = readdir(path.win32.join(root, distro, "home"));
      } catch {
        continue;
      }
      for (const user of users) {
        const dir = path.win32.join(root, distro, "home", user, ".local", "share", "imago");
        try {
          if (isDir(dir) && readdir(dir).length) return dir;
        } catch {
          // Not this one.
        }
      }
    }
  }
  return null;
}

async function copyTree(from, to) {
  await fs.promises.mkdir(to, { recursive: true });
  for (const entry of await fs.promises.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) {
      await fs.promises.copyFile(source, target);
      const stat = await fs.promises.stat(source);
      await fs.promises.utimes(target, stat.atime, stat.mtime);
    }
  }
}

/**
 * Copies `from` to `to` when `to` does not exist yet. Resolves {copied, from} and never throws:
 * a failure is reported and Imago starts with an empty data folder, leaving WSL as it was.
 */
export async function bringOverFromWsl({ to, from, say = console.log } = {}) {
  if (fs.existsSync(to)) return { copied: false };
  const source = from ?? findWslData();
  if (!source) return { copied: false };
  const incoming = `${to}.incoming`;
  try {
    await fs.promises.rm(incoming, { recursive: true, force: true });
    say(`Imago: copying your designs from ${source} to ${to}`);
    await copyTree(source, incoming);
    await fs.promises.rename(incoming, to);
    say("Imago: copy finished");
    return { copied: true, from: source };
  } catch (error) {
    say(`Imago: could not copy the data from WSL (${error.message}); it is still there.`);
    await fs.promises.rm(incoming, { recursive: true, force: true }).catch(() => {});
    return { copied: false, error: error.message };
  }
}
