import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, '..');

test('npm package inventory and compiled runtime retain fonts, samples, and one-shot fallbacks', async () => {
  const packageJson = JSON.parse(readFileSync(join(mcpRoot, 'package.json'), 'utf8'));
  const entrypoint = 'dist/mcp/src/index.js';
  assert.equal(packageJson.main, `./${entrypoint}`);
  assert.equal(packageJson.exports, `./${entrypoint}`);
  assert.equal(packageJson.bin['imago-mcp'], `./${entrypoint}`);

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = spawnSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: mcpRoot,
    encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const inventory = JSON.parse(packed.stdout)[0].files.map((file) => file.path);
  for (const required of [
    entrypoint,
    'dist/src/lib/templates.js',
    'dist/src/lib/textEffects.js',
    'fonts/ArchivoBlack.ttf',
    'assets/photo_portrait.jpg',
    'assets/photo_landscape.jpg',
    'assets/photo_city.jpg',
  ]) {
    assert.equal(inventory.includes(required), true, `npm pack omitted ${required}`);
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'imago-package-runtime-'));
  const priorCwd = process.cwd();
  process.env.IMAGO_DATA_DIR = join(temporaryRoot, 'data');
  process.env.IMAGO_EXPORTS_DIR = join(temporaryRoot, 'exports');
  process.chdir(temporaryRoot);
  try {
    const { createModernArtefact } = await import('../dist/mcp/src/modern.js');
    const result = await createModernArtefact({
      look: 'duotone-photo',
      title: 'PACKED',
      width: 320,
      height: 180,
      outputName: 'pack-runtime',
    });
    assert.equal(existsSync(result.outputPath), true);
    assert.match(result.notes.join(' '), /bundled landscape sample/);
    const metadata = await sharp(result.outputPath).metadata();
    assert.deepEqual([metadata.width, metadata.height, metadata.format], [320, 180, 'jpeg']);
  } finally {
    process.chdir(priorCwd);
    delete process.env.IMAGO_DATA_DIR;
    delete process.env.IMAGO_EXPORTS_DIR;
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
