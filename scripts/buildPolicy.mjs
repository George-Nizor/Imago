export const MAX_INITIAL_ENTRY_BYTES = 320 * 1024;
export const MAX_DEFERRED_ORT_BYTES = 24 * 1024 * 1024;

const DEFERRED_ASSET_PATTERN = /(ort(?:\.|-)|\.wasm(?:[?#]|$)|background-removal)/i;
const ORT_MODULE_PATTERN = /^ort(?:\.webgpu)?\.bundle\.min-[^.]+\.(?:js|mjs)$/i;
const ORT_WASM_PATTERN = /^ort-wasm-.*\.wasm$/i;

export function staticImports(source) {
  const imports = [];
  const pattern = /\bimport\s*(?!\()(?:[\w$*{}\s,]+?\s+from\s*)?["']\.\/([^"']+\.js)["']/g;
  for (const match of String(source).matchAll(pattern)) imports.push(match[1]);
  return imports;
}

export function staticImportClosure(entry, assetSources) {
  const visited = new Set();
  const pending = [entry];
  while (pending.length) {
    const asset = pending.pop();
    if (!asset || visited.has(asset)) continue;
    visited.add(asset);
    for (const dependency of staticImports(assetSources[asset] ?? '')) pending.push(dependency);
  }
  return [...visited];
}

export function equivalentOrtRuntimeSources(cpuSource, webgpuSource) {
  const normalise = (source) => String(source)
    .replaceAll('ort.webgpu.bundle.min.mjs', 'ort.bundle.min.mjs');
  return normalise(cpuSource) === normalise(webgpuSource);
}

export function auditBuildOutput({
  html,
  assetSizes,
  assetSources = {},
  entrySource = '',
  ortRuntimeSourcesEquivalent = true,
}) {
  const issues = [];
  const scriptMatch = html.match(/<script[^>]+src=["']\.\/assets\/([^"']+\.js)["']/i);
  if (!scriptMatch) {
    issues.push('Production HTML has no relative JavaScript entry.');
    return { issues, entry: null, entryBytes: 0 };
  }

  const entry = scriptMatch[1];
  const entryBytes = assetSizes[entry] ?? 0;
  if (!entryBytes) issues.push(`Initial entry ${entry} was not found in dist/assets.`);
  if (entryBytes > MAX_INITIAL_ENTRY_BYTES) {
    issues.push(
      `Initial entry is ${Math.ceil(entryBytes / 1024)} KiB; limit is ${MAX_INITIAL_ENTRY_BYTES / 1024} KiB.`,
    );
  }

  const initialReferences = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map(
    (match) => match[1],
  );
  const eagerHeavyAssets = initialReferences.filter((reference) =>
    DEFERRED_ASSET_PATTERN.test(reference),
  );
  if (eagerHeavyAssets.length) {
    issues.push(`Heavy cutout assets are loaded eagerly: ${eagerHeavyAssets.join(', ')}`);
  }
  if (/\.wasm(?:[?#"'`]|$)|ort\.(?:bundle|webgpu)/i.test(entrySource)) {
    issues.push('Initial JavaScript entry directly references the deferred cutout runtime.');
  }

  const sources = { ...assetSources, [entry]: entrySource || assetSources[entry] || '' };
  const eagerClosure = staticImportClosure(entry, sources);
  const eagerRuntimeAssets = eagerClosure.slice(1).filter((name) => DEFERRED_ASSET_PATTERN.test(name));
  if (eagerRuntimeAssets.length) {
    issues.push(`Initial static import graph reaches the cutout runtime: ${eagerRuntimeAssets.join(', ')}`);
  }

  const names = Object.keys(assetSizes);
  const ortModules = names.filter((name) => ORT_MODULE_PATTERN.test(name));
  const ortWasm = names.filter((name) => ORT_WASM_PATTERN.test(name));
  const hasCutoutRuntime = ortModules.length > 0 || ortWasm.length > 0;
  if (hasCutoutRuntime) {
    const mainModules = ortModules.filter((name) => name.endsWith('.js'));
    const workerModules = ortModules.filter((name) => name.endsWith('.mjs'));
    if (mainModules.length !== 1 || workerModules.length !== 1) {
      issues.push(
        `Cutout must emit one ONNX main module and one pthread worker; found ${mainModules.length} .js and ${workerModules.length} .mjs.`,
      );
    }
    if (ortWasm.length !== 1) {
      issues.push(`Cutout must emit one ONNX JSEP WASM binary; found ${ortWasm.length}.`);
    }
    const runtimeFamilies = new Set(
      ortModules.map((name) => (name.startsWith('ort.webgpu.') ? 'webgpu' : 'default')),
    );
    if (runtimeFamilies.size > 1) {
      issues.push('Equivalent default and WebGPU ONNX runtime families were emitted twice.');
    }
    const ortBytes = [...ortModules, ...ortWasm]
      .reduce((total, name) => total + (assetSizes[name] ?? 0), 0);
    if (ortBytes > MAX_DEFERRED_ORT_BYTES) {
      issues.push(
        `Deferred ONNX runtime is ${Math.ceil(ortBytes / 1024)} KiB; limit is ${MAX_DEFERRED_ORT_BYTES / 1024} KiB.`,
      );
    }
    if (!ortRuntimeSourcesEquivalent) {
      issues.push('Installed default and WebGPU ONNX sources diverged; the dedupe alias is no longer safe.');
    }
  }

  return { issues, entry, entryBytes, ortModules, ortWasm };
}
