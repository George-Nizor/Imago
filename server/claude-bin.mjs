// Finding Claude Code, and starting it without a shell.
//
// On Linux (and in WSL) a turn runs `claude` from PATH. On Windows npm's claude.cmd cannot be
// started without cmd.exe, and cmd.exe would re-read the long JSON arguments a turn passes, so the
// program itself is found instead: IMAGO_CLAUDE_BIN, the native installer's
// %USERPROFILE%\.local\bin\claude.exe, claude.exe on PATH, then the claude.exe inside npm's
// @anthropic-ai/claude-code package (beside claude.cmd on PATH or in %APPDATA%\npm). A service
// started by the launcher may not have the user's PATH, which is why the fixed places come first.
//
// Pure: the environment and the file test are injectable, so the Windows rules are tested anywhere.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fileExists = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

function pathValue(env) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  return key ? env[key] || "" : "";
}

/** Every file called `name` in a PATH directory, in PATH order (Windows rules). */
export function searchWindowsPath(name, env, exists = fileExists) {
  return pathValue(env).split(";").map((dir) => dir.trim().replace(/^"|"$/g, "")).filter(Boolean)
    .map((dir) => path.win32.join(dir, name)).filter((file) => exists(file));
}

/** The claude.exe to run on Windows, or null when there is none. */
export function findClaudeWindows({ env = process.env, exists = fileExists, homedir = os.homedir() } = {}) {
  const direct = [];
  if (env.IMAGO_CLAUDE_BIN?.trim()) direct.push(env.IMAGO_CLAUDE_BIN.trim());
  direct.push(path.win32.join(env.USERPROFILE || homedir, ".local", "bin", "claude.exe"));
  direct.push(...searchWindowsPath("claude.exe", env, exists));
  const hit = direct.find((file) => exists(file));
  if (hit) return hit;
  const shims = searchWindowsPath("claude.cmd", env, exists);
  if (env.APPDATA) shims.push(path.win32.join(env.APPDATA, "npm", "claude.cmd"));
  for (const shim of shims) {
    const program = path.win32.join(path.win32.dirname(shim), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (exists(program)) return program;
  }
  return null;
}

/** What `config.claudeBin` is: a found claude.exe on Windows, else the given program or `claude`. */
export function claudeBin(env = process.env, platform = process.platform) {
  if (platform === "win32") return findClaudeWindows({ env }) ?? (env.IMAGO_CLAUDE_BIN?.trim() || "claude.exe");
  const bin = env.IMAGO_CLAUDE_BIN?.trim() || "claude";
  // Turns run with the project as cwd, so a relative path would resolve there; pin it to ours.
  return bin.includes("/") && !path.isAbsolute(bin) ? path.resolve(bin) : bin;
}
