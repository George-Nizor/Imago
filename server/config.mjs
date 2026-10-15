import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { claudeBin } from "./claude-bin.mjs";

/** %LOCALAPPDATA% on Windows (where Imago keeps its data and Fabula its engine). */
function localAppData(env) {
  return env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");
}

/**
 * Where Fabula keeps projects (comma separated in IMAGO_FABULA_PROJECTS), else its default place and a sibling checkout's media.
 * On Windows that is the folder Fabula's own settings name (%LOCALAPPDATA%\Fabula\engine\settings.json), else Videos\Fabula.
 */
export function fabulaRoots(env = process.env, platform = process.platform) {
  const given = String(env.IMAGO_FABULA_PROJECTS ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  if (given.length) return given.map((r) => path.resolve(r));
  const roots = platform === "win32" ? [windowsFabulaProjects(env)] : [path.join(homedir(), ".local", "share", "fabula", "projects")];
  const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "Fabula", "media");
  if (existsSync(checkout)) roots.push(checkout);
  return roots;
}

function windowsFabulaProjects(env) {
  try {
    const settings = JSON.parse(readFileSync(path.join(localAppData(env), "Fabula", "engine", "settings.json"), "utf8"));
    if (typeof settings.projectsRoot === "string" && path.win32.isAbsolute(settings.projectsRoot)) return settings.projectsRoot;
  } catch {
    // No Fabula on this machine, or its default folder.
  }
  return path.join(env.USERPROFILE || homedir(), "Videos", "Fabula");
}

/** Imago's own data: IMAGO_DATA_DIR, else %LOCALAPPDATA%\Imago on Windows and ~/.local/share/imago elsewhere. */
export function defaultDataDir(env = process.env, platform = process.platform) {
  if (env.IMAGO_DATA_DIR?.trim()) return path.resolve(env.IMAGO_DATA_DIR.trim());
  return platform === "win32" ? path.join(localAppData(env), "Imago") : path.join(homedir(), ".local", "share", "imago");
}

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

function electronFromPackage() {
  try {
    // The electron package exports the path of its binary.
    return createRequire(import.meta.url)("electron");
  } catch {
    return "";
  }
}

/** Libraries unpacked by `npm run setup:libs` (no root needed), used when IMAGO_CHROMIUM_LIBS is unset. */
export const LOCAL_CHROMIUM_LIBS = path.join(PACKAGE_ROOT, "tools", "chromium-libs", "usr", "lib", "x86_64-linux-gnu");

/** "opus=claude-opus-5-5,fable=claude-fable-5-1" -> {opus, fable}; bad pairs are skipped. */
export function parseFurtherModels(value) {
  const out = {};
  for (const pair of String(value ?? "").split(",")) {
    const [key, model] = pair.split("=").map((x) => x?.trim());
    if (/^[a-z][a-z0-9-]{0,20}$/.test(key ?? "") && /^[A-Za-z0-9._:[\]-]{1,80}$/.test(model ?? "")) out[key] = model;
  }
  return out;
}
export const DEFAULT_FURTHER_MODELS = "opus=claude-opus-5-5,fable=claude-fable-5-1";

/** All settings come from the environment (see docs/redesign-contract.md); overrides are for tests. */
export function loadConfig(env = process.env, overrides = {}) {
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const config = {
    host: "127.0.0.1",
    port: num(env.PORT, 49321),
    webRoot: path.resolve(PACKAGE_ROOT, env.IMAGO_WEB_ROOT?.trim() || "web/dist"),
    dataDir: defaultDataDir(env),
    fontsDir: path.join(PACKAGE_ROOT, "fonts"),
    claudeBin: claudeBin(env),
    model: env.IMAGO_MODEL?.trim() || "claude-sonnet-5-5",
    effort: env.IMAGO_EFFORT?.trim() || "medium",
    furtherModels: parseFurtherModels(env.IMAGO_FURTHER_MODELS?.trim() || DEFAULT_FURTHER_MODELS),
    furtherEffort: env.IMAGO_FURTHER_EFFORT?.trim() || "high",
    // The face pack's classification turn: a small model at low effort; it only looks and labels.
    facesModel: env.IMAGO_FACES_MODEL?.trim() || "claude-haiku-5-5",
    facesEffort: "low",
    // How long the classifier waits after the last cut-out finished before it takes the batch (ms).
    facesBatchMs: 2000,
    turnTimeoutMs: num(env.IMAGO_TURN_TIMEOUT_MS, 600_000),
    electronBin: env.IMAGO_ELECTRON_BIN?.trim() || electronFromPackage(),
    // Directory holding the Chromium shared libraries a minimal Linux/WSL image may lack.
    chromiumLibs: env.IMAGO_CHROMIUM_LIBS?.trim() || (existsSync(LOCAL_CHROMIUM_LIBS) ? LOCAL_CHROMIUM_LIBS : ""),
    // Extra browser origins allowed to make changing requests (the Vite dev server); see server/index.mjs.
    allowedOrigins: String(env.IMAGO_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter((o) => /^https?:\/\/[^/]+$/.test(o)),
    fabulaRoots: fabulaRoots(env),
    conceptConcurrency: Math.min(8, Math.floor(num(env.IMAGO_CONCEPT_CONCURRENCY, 3))),
    renderScript: path.join(PACKAGE_ROOT, "render", "render.cjs"),
    mcpScript: path.join(PACKAGE_ROOT, "server", "render-mcp.mjs"),
    ...overrides,
  };
  config.projectsDir = path.join(config.dataDir, "projects");
  config.facesDir = path.join(config.dataDir, "faces");
  return config;
}
