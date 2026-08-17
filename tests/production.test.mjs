import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagnosticCode,
  makeErrorNotice,
} from '../src/lib/diagnostics.ts';
import {
  MAX_DEFERRED_ORT_BYTES,
  MAX_INITIAL_ENTRY_BYTES,
  auditBuildOutput,
  equivalentOrtRuntimeSources,
  staticImportClosure,
} from '../scripts/buildPolicy.mjs';
import { CUTOUT_MODEL } from '../src/lib/cutout.ts';
import { noiseTextureSize } from '../src/lib/backgrounds.ts';

test('diagnostic codes are stable, scoped, and user notices omit raw failures', () => {
  assert.equal(diagnosticCode('cutout'), 'IMAGO-CUTOUT-001');
  assert.equal(diagnosticCode('export-image'), 'IMAGO-EXPORT-001');
  const notice = makeErrorNotice('storage', 'Saved cutouts are unavailable.');
  assert.equal(notice.code, 'IMAGO-STORAGE-001');
  assert.equal(JSON.stringify(notice).includes('/Users/example/private-image.png'), false);
});

test('first-use cutout selects the bounded quantized model', () => {
  assert.equal(CUTOUT_MODEL, 'isnet_quint8');
});

test('background texture work stays bounded at 4K and preserves small canvases', () => {
  assert.deepEqual(noiseTextureSize(3840, 2160), { width: 640, height: 360 });
  assert.deepEqual(noiseTextureSize(320, 180), { width: 320, height: 180 });
});

test('bundle policy accepts a compact entry with deferred cutout assets', () => {
  const result = auditBuildOutput({
    html: '<script type="module" src="./assets/index-safe.js"></script>',
    assetSizes: {
      'index-safe.js': MAX_INITIAL_ENTRY_BYTES - 1,
      'ort.bundle.min-main.js': 390_000,
      'ort.bundle.min-worker.mjs': 400_000,
      'ort-wasm-simd-threaded.jsep-deferred.wasm': 23_900_000,
    },
  });
  assert.deepEqual(result.issues, []);
});

test('bundle policy rejects duplicate default and WebGPU runtime families', () => {
  const result = auditBuildOutput({
    html: '<script type="module" src="./assets/index-safe.js"></script>',
    assetSizes: {
      'index-safe.js': 10_000,
      'ort.bundle.min-main.js': 390_000,
      'ort.bundle.min-worker.mjs': 400_000,
      'ort.webgpu.bundle.min-main.js': 390_000,
      'ort.webgpu.bundle.min-worker.mjs': 400_000,
      'ort-wasm-simd-threaded.jsep-deferred.wasm': 23_900_000,
    },
  });
  assert.ok(result.issues.some((issue) => /one ONNX main module/.test(issue)));
  assert.ok(result.issues.some((issue) => /runtime families were emitted twice/.test(issue)));
  assert.ok(result.issues.some((issue) => /Deferred ONNX runtime/.test(issue)));
});

test('bundle policy traces eager runtime through static imports only', () => {
  const closure = staticImportClosure('index.js', {
    'index.js': 'import { boot } from "./shell.js"; import("./lazy.js");',
    'shell.js': 'import "./ort.bundle.min-main.js";',
    'lazy.js': 'import "./not-eager.js";',
  });
  assert.deepEqual(closure, ['index.js', 'shell.js', 'ort.bundle.min-main.js']);
  const result = auditBuildOutput({
    html: '<script type="module" src="./assets/index.js"></script>',
    assetSizes: { 'index.js': 100, 'shell.js': 100 },
    assetSources: {
      'index.js': 'import { boot } from "./shell.js"; import("./lazy.js");',
      'shell.js': 'import "./background-removal-runtime.js";',
    },
  });
  assert.ok(result.issues.some((issue) => /static import graph/.test(issue)));
});

test('the ONNX dedupe gate allows only self-filename differences', () => {
  const cpu = 'new Worker(new URL("ort.bundle.min.mjs", import.meta.url));\n//# sourceMappingURL=ort.bundle.min.mjs.map';
  const gpu = 'new Worker(new URL("ort.webgpu.bundle.min.mjs", import.meta.url));\n//# sourceMappingURL=ort.webgpu.bundle.min.mjs.map';
  assert.equal(equivalentOrtRuntimeSources(cpu, gpu), true);
  assert.equal(equivalentOrtRuntimeSources(cpu, `${gpu}\nregisterSpecialGpuOnlyCode()`), false);
  assert.ok(MAX_DEFERRED_ORT_BYTES > 24_000_000);
});

test('bundle policy rejects oversized entries and eager model assets', () => {
  const result = auditBuildOutput({
    html: [
      '<script type="module" src="./assets/index-heavy.js"></script>',
      '<link rel="modulepreload" href="./assets/ort.bundle.js">',
    ].join(''),
    assetSizes: { 'index-heavy.js': MAX_INITIAL_ENTRY_BYTES + 1 },
  });
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0], /Initial entry/);
  assert.match(result.issues[1], /loaded eagerly/);
});

test('bundle policy rejects a model runtime reference hidden in the initial entry', () => {
  const result = auditBuildOutput({
    html: '<script type="module" src="./assets/index-safe.js"></script>',
    assetSizes: { 'index-safe.js': 10_000 },
    entrySource: 'const model = "./ort.bundle.min.js";',
  });
  assert.deepEqual(result.issues, [
    'Initial JavaScript entry directly references the deferred cutout runtime.',
  ]);
});
