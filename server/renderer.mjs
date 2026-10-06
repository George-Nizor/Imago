import fs from "node:fs";
import path from "node:path";
import { runProcess } from "./process.mjs";

/** Environment for Electron: a clean node-less env plus the optional no-sudo library directory. */
export function electronEnv(config, base = process.env) {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  if (config.chromiumLibs) env.LD_LIBRARY_PATH = [config.chromiumLibs, base.LD_LIBRARY_PATH].filter(Boolean).join(":");
  return env;
}

export function electronFlags() {
  const flags = ["--no-sandbox", "--no-zygote", "--disable-gpu", "--disable-dev-shm-usage"];
  // Chromium picks its platform before any script runs, so headless has to be on the command line.
  if (process.platform === "linux") flags.push("--ozone-platform=headless");
  return flags;
}

export class RenderError extends Error {
  constructor(message) {
    super(message);
    this.code = "RENDER_FAILED";
  }
}

/** Renders `htmlFile` (width x height CSS px) to `out`. Resolves {width,height,bytes}. */
export async function renderHtml(config, { htmlFile, width, height, scale = 1, format = "png", out }) {
  if (!config.electronBin || !fs.existsSync(config.electronBin)) throw new RenderError("The renderer (Electron) is not installed. Run npm install.");
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  let stdout = "";
  const result = await runProcess({
    binary: config.electronBin,
    args: [
      ...electronFlags(),
      config.renderScript,
      `--html=${htmlFile}`,
      `--width=${width}`,
      `--height=${height}`,
      `--scale=${scale}`,
      `--format=${format}`,
      `--out=${out}`,
      `--fonts=${config.fontsDir}`,
    ],
    cwd: path.dirname(htmlFile),
    env: electronEnv(config),
    timeoutMs: 60_000,
    onStdoutLine: (line) => {
      stdout += `${line}\n`;
    },
  }).catch((error) => {
    throw new RenderError(error.message);
  });
  const line = stdout.trim().split("\n").reverse().find((l) => l.startsWith("{"));
  if (result.timedOut) throw new RenderError("The render timed out.");
  if (result.code !== 0 || !line) {
    const reason = result.stderr.split("\n").filter(Boolean).slice(-3).join(" ") || `exit code ${result.code}`;
    throw new RenderError(`The render failed: ${reason}`);
  }
  return JSON.parse(line);
}
