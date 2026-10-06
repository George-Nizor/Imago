import fs from "node:fs";
import { capture } from "./process.mjs";
import { electronEnv } from "./renderer.mjs";

const CACHE_MS = 60_000;

const CLAUDE_FIX_MISSING = "Install Claude Code (https://claude.com/claude-code), then restart Imago.";
const CLAUDE_FIX_SIGNED_OUT = "Open a terminal, run `claude`, and sign in with your Claude subscription.";

function libsHint(reason) {
  const lib = /([\w.+-]+\.so[\w.]*): cannot open shared object file/.exec(reason)?.[1];
  const base = "Run `npm run setup:libs` in the Imago folder (no root needed), or install the Chromium libraries yourself (on Debian/Ubuntu: `sudo apt-get install -y libnspr4 libnss3 libasound2t64`)";
  return lib
    ? `${base}, or point IMAGO_CHROMIUM_LIBS at a folder containing ${lib} and the other Chromium libraries.`
    : `${base}, or point IMAGO_CHROMIUM_LIBS at a folder of them.`;
}

/** Readiness of Claude Code and of the renderer, probed lazily and cached for a minute. */
export function createCapabilities(config) {
  let cache;

  async function probeClaude() {
    let version;
    try {
      version = await capture(config.claudeBin, ["--version"], { timeoutMs: 8_000 });
    } catch (error) {
      return { state: "missing", reason: `Claude Code was not found (${config.claudeBin}).`, fix: CLAUDE_FIX_MISSING, detail: error.message };
    }
    if (version.code !== 0) return { state: "missing", reason: "Claude Code did not start.", fix: CLAUDE_FIX_MISSING };
    // `claude auth status` prints JSON containing "loggedIn": true when signed in.
    const auth = await capture(config.claudeBin, ["auth", "status"], { timeoutMs: 8_000 }).catch(() => null);
    const signedIn = auth && auth.code === 0 && /"loggedIn"\s*:\s*true/.test(auth.stdout);
    return signedIn
      ? { state: "ready", reason: "", fix: "" }
      : { state: "signed-out", reason: "Claude Code is not signed in.", fix: CLAUDE_FIX_SIGNED_OUT };
  }

  async function probeRenderer() {
    if (!config.electronBin || !fs.existsSync(config.electronBin)) {
      return { state: "missing", reason: "Electron is not installed.", fix: "Run `npm install` in the Imago folder." };
    }
    const result = await capture(config.electronBin, ["--no-sandbox", "--version"], { timeoutMs: 15_000, env: electronEnv(config) }).catch((e) => ({ code: -1, stderr: e.message, stdout: "" }));
    if (result.code === 0) return { state: "ready", reason: "", fix: "" };
    const reason = (result.stderr || "Electron did not start.").split("\n").filter(Boolean).slice(-2).join(" ");
    return { state: "missing", reason, fix: process.platform === "linux" ? libsHint(reason) : "Reinstall Electron with `npm install`." };
  }

  async function get({ force = false } = {}) {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
    const [claude, renderer] = await Promise.all([probeClaude(), probeRenderer()]);
    const value = { claude, renderer, model: config.model, effort: config.effort };
    cache = { at: Date.now(), value };
    return value;
  }

  return { get, invalidate: () => void (cache = undefined) };
}
