// Builds the Windows release bundle Instrumenta installs: .release/imago-<version>.zip, made from
// the folder .release/imago-<version>/.
//
// The bundle keeps the repository's layout for every file the server reads (server/, render/,
// fonts/, web/dist), so the same path code works in a checkout and in an install. `imago-bundle.json`
// at the root marks it. Beside those it carries a pinned node.exe in runtime/, and the production
// node_modules as `npm ci` left them on the build machine: sharp with its libvips, onnxruntime-node
// and the background-removal models, and Electron with its dist (the server starts electron.exe for
// every render). Nothing is bundled with esbuild.
//
// Run on Windows after `npm ci` and `npm run build`; the native parts are whatever that install
// fetched, so a bundle staged anywhere else would carry the wrong binaries.
//
//   node scripts/package-release.mjs              stage and zip (Windows only)
//   node scripts/package-release.mjs --dry-run    print what would be staged; downloads nothing
//   node scripts/package-release.mjs --any-platform --no-zip
//                                                 stage on Linux, to check the layout and the
//                                                 generated product.json; not installable
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE = {
  version: "22.22.2",
  sha256: "7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c",
};
// The one platform a release is for. Packages that ship binaries for every platform are trimmed to it.
const TARGET = { platform: "win32", arch: "x64" };

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const anyPlatform = args.includes("--any-platform");
const noZip = args.includes("--no-zip");

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const out = path.join(root, ".release");
const stage = path.join(out, `imago-${version}`);
const cache = path.join(root, ".cache/release");

function run(command, commandArgs, cwd = root) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed.`);
}
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function sizeOf(target) {
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(target)) total += sizeOf(path.join(target, entry));
  return total;
}
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

async function nodeExecutable() {
  const name = `node-v${NODE.version}-win-x64`;
  const zip = path.join(cache, `${name}.zip`);
  mkdirSync(cache, { recursive: true });
  if (!existsSync(zip) || sha256(zip) !== NODE.sha256) {
    const response = await fetch(`https://nodejs.org/dist/v${NODE.version}/${name}.zip`);
    if (!response.ok) throw new Error(`Node ${NODE.version} could not be downloaded (${response.status}).`);
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  }
  if (sha256(zip) !== NODE.sha256) throw new Error("The Node download does not match its pinned SHA-256.");
  const extracted = path.join(cache, name);
  if (!existsSync(path.join(extracted, "node.exe"))) {
    rmSync(extracted, { recursive: true, force: true });
    if (process.platform === "win32")
      run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), [
        "-xf",
        zip,
        "-C",
        cache,
        `${name}/node.exe`,
        `${name}/LICENSE`,
      ]);
    else run("unzip", ["-q", "-o", zip, `${name}/node.exe`, `${name}/LICENSE`, "-d", cache]);
  }
  return extracted;
}

// Every package the lockfile does not mark dev-only, as installed. A package's own nested
// node_modules is left out of its copy: the lockfile lists those entries separately, and a nested
// entry marked dev stays behind. Optional packages for other platforms are simply not on disk.
function productionPackages() {
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const packages = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith("node_modules/") || entry.dev || entry.link) continue;
    if (!existsSync(path.join(root, key))) continue;
    packages.push(key);
  }
  return packages.sort();
}

// onnxruntime-node ships bin/napi-v*/<platform>/<arch> for every platform; keep the target's.
function keepForTarget(relative) {
  const parts = relative.split(/[\\/]/);
  const at = parts.indexOf("onnxruntime-node");
  if (at < 0 || parts[at + 1] !== "bin" || !/^napi-v\d+$/.test(parts[at + 2] ?? "")) return true;
  const [platform, arch] = parts.slice(at + 3, at + 5);
  if (platform && platform !== TARGET.platform) return false;
  if (arch && arch !== TARGET.arch) return false;
  return true;
}

function copyPackage(key) {
  const from = path.join(root, key);
  const nested = path.join(from, "node_modules");
  cpSync(from, path.join(stage, key), {
    recursive: true,
    filter: (source) => source !== nested && keepForTarget(path.relative(root, source)),
  });
}

const product = JSON.parse(readFileSync(path.join(root, "instrumenta/product.json"), "utf8"));
const { launch } = product;
// The checkout's manifest starts `npm start`; an installed release starts its own node.exe. The
// launcher sets PORT and HOST itself.
const bundledProduct = {
  schemaVersion: 1,
  id: product.id,
  displayName: product.displayName,
  kind: product.kind,
  adapter: "web-service",
  versionSource: { type: "package-json", path: "package.json" },
  launch: {
    type: "service",
    port: launch.port,
    fallbackPort: launch.fallbackPort,
    health: launch.health,
    command: ["runtime/node.exe", "server/index.mjs"],
    cwd: ".",
    env: { ...launch.env, IMAGO_PACKAGED: "1" },
  },
  assets: product.assets,
};
// What the server needs at runtime: its package.json carries the version /api/health reports and
// "type": "module". Scripts and devDependencies stay behind.
const bundledPackage = {
  name: pkg.name,
  version,
  private: true,
  license: pkg.license,
  type: pkg.type,
  dependencies: pkg.dependencies,
};
const sources = ["server", "render", "fonts", "web/dist", product.assets.mark, "LICENSE"];

if (!existsSync(path.join(root, "web/dist/index.html"))) {
  if (dryRun) console.log("warning: web/dist/index.html is missing; run npm run build before packaging.");
  else throw new Error("Run npm run build first.");
}
const packages = productionPackages();

if (dryRun) {
  console.log(`Imago ${version}, staged at ${path.relative(root, stage)}/ and zipped to .release/imago-${version}.zip\n`);
  console.log(`runtime/node.exe          Node ${NODE.version} win-x64, SHA-256 ${NODE.sha256.slice(0, 12)}...`);
  console.log(`runtime/NODE-LICENSE`);
  for (const source of sources)
    console.log(`${source.padEnd(25)} ${existsSync(path.join(root, source)) ? mb(sizeOf(path.join(root, source))) : "MISSING"}`);
  const top = packages.filter((key) => key.split("node_modules/").length === 2);
  const total = packages.reduce((sum, key) => sum + sizeOf(path.join(root, key)), 0);
  console.log(`node_modules/             ${packages.length} production packages, ${mb(total)} as installed here (before trimming)`);
  console.log(`  ${top.map((key) => key.slice("node_modules/".length)).join(", ")}`);
  console.log(`package.json              ${JSON.stringify(bundledPackage)}`);
  console.log(`imago-bundle.json         { version, node, electron, builtAt }`);
  console.log(`instrumenta/product.json\n${JSON.stringify(bundledProduct, null, 2)}`);
  process.exit(0);
}

if (process.platform !== TARGET.platform && !anyPlatform)
  throw new Error("The release is staged on Windows, from a Windows npm ci. Pass --any-platform to stage a layout check anyway.");
const electronDist = path.join(root, "node_modules/electron/dist");
if (process.platform === TARGET.platform && !existsSync(path.join(electronDist, "electron.exe")))
  throw new Error("node_modules/electron/dist/electron.exe is missing; npm ci did not finish Electron's download.");

rmSync(stage, { recursive: true, force: true });
rmSync(path.join(out, `imago-${version}.zip`), { force: true });
mkdirSync(stage, { recursive: true });

for (const source of sources) cpSync(path.join(root, source), path.join(stage, source), { recursive: true });
for (const key of packages) copyPackage(key);

const nodeDirectory = await nodeExecutable();
cpSync(path.join(nodeDirectory, "node.exe"), path.join(stage, "runtime/node.exe"));
cpSync(path.join(nodeDirectory, "LICENSE"), path.join(stage, "runtime/NODE-LICENSE"));

mkdirSync(path.join(stage, "instrumenta"), { recursive: true });
writeFileSync(path.join(stage, "instrumenta/product.json"), `${JSON.stringify(bundledProduct, null, 2)}\n`);
writeFileSync(path.join(stage, "package.json"), `${JSON.stringify(bundledPackage, null, 2)}\n`);
const electronVersion = JSON.parse(readFileSync(path.join(root, "node_modules/electron/package.json"), "utf8")).version;
writeFileSync(
  path.join(stage, "imago-bundle.json"),
  `${JSON.stringify({ version, node: NODE.version, electron: electronVersion, builtAt: new Date().toISOString() }, null, 2)}\n`,
);
console.log(`${path.relative(root, stage)}/ (${mb(sizeOf(stage))})`);

if (!noZip) {
  const zip = path.join(out, `imago-${version}.zip`);
  // Python's zipfile writes the same archive on every platform: forward slashes, no directory
  // entries the launcher's extractor would have to skip, and nothing outside the stage.
  run(process.platform === "win32" ? "python" : "python3", [
    "-I",
    "-c",
    [
      "import os, sys, zipfile",
      "stage, target = sys.argv[1], sys.argv[2]",
      "with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:",
      "    for folder, _, files in sorted(os.walk(stage)):",
      "        for name in sorted(files):",
      "            full = os.path.join(folder, name)",
      "            z.write(full, os.path.relpath(full, stage).replace(os.sep, '/'))",
    ].join("\n"),
    stage,
    zip,
  ]);
  console.log(`${path.relative(root, zip)} (${mb(statSync(zip).size)})`);
}
