// Smoke test for a staged release: node scripts/smoke-release.mjs --root .release/imago-<version>
//
// The release workflow runs this with the bundle's own runtime/node.exe, so every check below runs
// on the Node, Electron, sharp and onnxruntime the zip ships. It starts the bundled server against
// a throwaway data folder the way Instrumenta does (IMAGO_PACKAGED=1, PORT and HOST set), and
// checks /api/health, the interface, and that the server finds its renderer. Then it renders twice
// through the bundle's server/renderer.mjs, once with a font from fonts/ and once without, and
// fails if the two match (the font did not load). Last it cuts out the background of the first
// render, which loads onnxruntime and the background-removal models.
//
// Pointed at a checkout (--root .) it runs the same checks on Linux or WSL with the system Node.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const root = path.resolve(option("--root", "."));
const port = Number(option("--port", "49399"));
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const bundledNode = path.join(root, "runtime", "node.exe");
const node = process.platform === "win32" && existsSync(bundledNode) ? bundledNode : process.execPath;
const work = mkdtempSync(path.join(tmpdir(), "imago-smoke-"));
const dataDir = path.join(work, "data");
const env = {
  ...process.env,
  IMAGO_PACKAGED: "1",
  IMAGO_DATA_DIR: dataDir,
  IMAGO_WEB_ROOT: "web/dist",
  PORT: String(port),
  HOST: "127.0.0.1",
};
const base = `http://127.0.0.1:${port}`;

function check(condition, message) {
  if (!condition) throw new Error(message);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(server) {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(`The bundled server exited with code ${server.exitCode}.`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error("The bundled server did not answer /api/health.");
}

async function serverChecks() {
  console.log(`Starting ${node} server/index.mjs in ${root}`);
  const server = spawn(node, ["server/index.mjs"], { cwd: root, env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
  try {
    const health = await waitForHealth(server);
    check(health.ok === true, `/api/health said ${JSON.stringify(health)}.`);
    check(health.version === version, `/api/health reports ${health.version}, the bundle is ${version}.`);
    const page = await (await fetch(`${base}/`)).text();
    check(page.includes('<div id="root">'), "The interface was not served.");
    const capabilities = await (await fetch(`${base}/api/capabilities`)).json();
    check(capabilities.renderer?.state === "ready", `The renderer is not ready: ${JSON.stringify(capabilities.renderer)}.`);
    console.log(`Imago ${health.version}: health ok, interface served, renderer ready (Claude Code: ${capabilities.claude?.state}).`);
  } finally {
    server.kill();
  }
}

async function renderChecks() {
  const load = (file) => import(pathToFileURL(path.join(root, file)).href);
  const { loadConfig } = await load("server/config.mjs");
  const { renderHtml, differenceFrom } = await load("server/renderer.mjs");
  const { cutOutBytes } = await load("server/cutout.mjs");
  const config = loadConfig(env);
  check(config.electronBin && existsSync(config.electronBin), `Electron was not found (${config.electronBin || "no path"}).`);

  const page = (head, family) =>
    `<!doctype html><html><head><meta charset="utf-8">${head}<style>html,body{margin:0;background:#f4efe6}` +
    `h1{margin:0;padding:40px;font:120px/1 ${family};color:#1d1a16}</style></head><body><h1>Imago 123</h1></body></html>`;
  const withFont = path.join(work, "font", "design.html");
  const without = path.join(work, "plain", "design.html");
  for (const [file, html] of [
    [withFont, page('<link rel="stylesheet" href="/fonts/fonts.css">', '"Bangers", serif')],
    [without, page("", "serif")],
  ]) {
    rmSync(path.dirname(file), { recursive: true, force: true });
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  const size = { width: 640, height: 360 };
  const a = await renderHtml(config, { htmlFile: withFont, ...size, out: path.join(work, "font.png") });
  check(a.width === size.width && a.height === size.height, `The render came back ${a.width}x${a.height}.`);
  await renderHtml(config, { htmlFile: without, ...size, out: path.join(work, "plain.png") });
  const difference = await differenceFrom(path.join(work, "font.png"), path.join(work, "plain.png"));
  check(difference > 0.5, `The render with Bangers matches the one without (difference ${difference.toFixed(2)}); fonts/ did not load.`);
  console.log(`Rendered ${a.width}x${a.height} with Electron; Bangers differs from the fallback by ${difference.toFixed(2)}.`);

  const cut = await cutOutBytes(readFileSync(path.join(work, "font.png")));
  check(cut.png?.length > 0 && cut.width === size.width, "The background cut-out returned no image.");
  console.log(`Cut out the background (${cut.width}x${cut.height}) with onnxruntime.`);
}

try {
  await serverChecks();
  await renderChecks();
  console.log("Smoke test passed.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
