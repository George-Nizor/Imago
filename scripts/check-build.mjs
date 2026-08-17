import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBuildOutput, equivalentOrtRuntimeSources } from './buildPolicy.mjs';

const distDirectory = new URL('../dist/', import.meta.url);
const assetsDirectory = new URL('./assets/', distDirectory);
const html = await readFile(new URL('./index.html', distDirectory), 'utf8');
const assetSizes = {};
const assetSources = {};
for (const name of await readdir(assetsDirectory)) {
  assetSizes[name] = (await stat(join(fileURLToPath(assetsDirectory), name))).size;
  if (/\.(?:js|mjs)$/.test(name)) {
    assetSources[name] = await readFile(new URL(`./assets/${name}`, distDirectory), 'utf8');
  }
}

const cpuOrtSource = await readFile(
  new URL('../node_modules/onnxruntime-web/dist/ort.bundle.min.mjs', import.meta.url),
  'utf8',
);
const webgpuOrtSource = await readFile(
  new URL('../node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs', import.meta.url),
  'utf8',
);
const firstPass = auditBuildOutput({ html, assetSizes, assetSources });
const entrySource = firstPass.entry ? assetSources[firstPass.entry] ?? '' : '';
const result = auditBuildOutput({
  html,
  assetSizes,
  assetSources,
  entrySource,
  ortRuntimeSourcesEquivalent: equivalentOrtRuntimeSources(cpuOrtSource, webgpuOrtSource),
});
if (result.issues.length) {
  for (const issue of result.issues) console.error(`[bundle] ${issue}`);
  process.exitCode = 1;
} else {
  console.log(
    `[bundle] Initial entry ${result.entry}: ${(result.entryBytes / 1024).toFixed(1)} KiB; cutout runtime deferred.`,
  );
}
