import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, '..');
const entrypoint = join(mcpRoot, 'dist', 'mcp', 'src', 'index.js');

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = result.content?.find((item) => item.type === 'text')?.text ?? 'unknown error';
    assert.fail(`${name} failed: ${text}`);
  }
  return result;
}

test('compiled stdio server negotiates, lists annotated tools, and completes an editable export workflow', async () => {
  assert.equal(existsSync(entrypoint), true, 'npm run build must produce the compiled MCP entrypoint');
  const compiledPaths = await import('../dist/mcp/src/paths.js');
  assert.equal(compiledPaths.MCP_ROOT, resolve(mcpRoot));
  assert.equal(compiledPaths.ROOT, resolve(mcpRoot, '..'));
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'imago-mcp-protocol-'));
  const dataDirectory = join(temporaryRoot, 'data');
  const exportsDirectory = join(temporaryRoot, 'exports');
  const inputPath = join(temporaryRoot, 'source.png');
  await sharp({
    create: { width: 96, height: 64, channels: 4, background: '#d45b72' },
  })
    .png()
    .toFile(inputPath);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    cwd: mcpRoot,
    env: {
      ...getDefaultEnvironment(),
      IMAGO_DATA_DIR: dataDirectory,
      IMAGO_EXPORTS_DIR: exportsDirectory,
      IMAGO_URL: 'http://127.0.0.1:9',
    },
    stderr: 'pipe',
  });
  let serverStderr = '';
  transport.stderr?.on('data', (chunk) => {
    serverStderr += String(chunk);
  });
  const client = new Client({ name: 'imago-production-test', version: '1.0.0' });
  try {
    await client.connect(transport).catch((error) => {
      throw new Error(`MCP connect failed: ${serverStderr || error.message}`);
    });
    assert.deepEqual(client.getServerVersion(), { name: 'imago', version: '0.1.0' });
    assert.match(client.getInstructions() ?? '', /create_document/);

    const listing = await client.listTools();
    assert.equal(listing.tools.length, 34);
    const names = new Set(listing.tools.map((tool) => tool.name));
    for (const expected of [
      'create_document',
      'replace_slot',
      'import_image',
      'add_text',
      'update_text',
      'set_background',
      'cutout_layer',
      'apply_beauty',
      'set_image_grade',
      'edit_image_pixels',
      'edit_animation',
      'export_document',
      'export_animation',
      'open_document_in_imago_source',
    ]) {
      assert.equal(names.has(expected), true, `missing tool ${expected}`);
    }
    const listTemplates = listing.tools.find((tool) => tool.name === 'list_templates');
    assert.equal(listTemplates?.annotations?.readOnlyHint, true);
    assert.equal(listTemplates?.annotations?.openWorldHint, false);
    const deleteDocument = listing.tools.find((tool) => tool.name === 'delete_document');
    assert.equal(deleteDocument?.annotations?.destructiveHint, true);
    for (const tool of listing.tools) {
      assert.ok(tool.outputSchema, `${tool.name} must publish an output schema`);
      assert.ok(tool.annotations, `${tool.name} must publish annotations`);
    }

    const legacyCatalog = await call(client, 'list_background_variants');
    assert.deepEqual(legacyCatalog.structuredContent?.variants, [
      'solid', 'split', 'linear', 'radial', 'panels', 'wash', 'punch',
    ]);
    assert.equal(
      legacyCatalog.content[0].text,
      JSON.stringify(legacyCatalog.structuredContent, null, 2),
    );

    const catalogResult = await call(client, 'list_templates');
    const catalog = catalogResult.structuredContent?.catalog;
    assert.equal(Array.isArray(catalog?.templates), true);
    assert.equal(catalog.templates.length, 6);

    let mutation = await call(client, 'create_document', {
      documentId: 'protocol-demo',
      name: 'Protocol Demo',
      kind: 'thumbnail',
      templateId: 'split-spotlight',
      sizeId: 'youtube-720',
      title: 'FIRST PASS',
      seed: 17,
    });
    let contentHash = mutation.structuredContent.contentHash;
    assert.match(contentHash, /^[a-f0-9]{64}$/);
    const initialHash = contentHash;
    mutation = await call(client, 'replace_slot', {
      documentId: 'protocol-demo',
      expectedHash: contentHash,
      slotId: 'support-main',
      inputPath,
      removeBackground: false,
    });
    contentHash = mutation.structuredContent.contentHash;
    mutation = await call(client, 'edit_image_pixels', {
      documentId: 'protocol-demo',
      expectedHash: contentHash,
      layerId: 'layer-support-main',
      mode: 'erase',
      points: [{ x: 0.5, y: 0.5 }],
      radius: 0.12,
      strength: 0.5,
      soft: true,
    });
    contentHash = mutation.structuredContent.contentHash;
    mutation = await call(client, 'update_text', {
      documentId: 'protocol-demo',
      expectedHash: contentHash,
      layerId: 'layer-title',
      text: 'FINAL CUT',
      effect: 'foil-gold',
      fill: '#f0ede6',
    });
    contentHash = mutation.structuredContent.contentHash;
    mutation = await call(client, 'set_background', {
      documentId: 'protocol-demo',
      expectedHash: contentHash,
      variant: 'radial',
      seed: 44,
      primary: '#18121f',
      accent: '#729488',
    });
    contentHash = mutation.structuredContent.contentHash;
    mutation = await call(client, 'edit_animation', {
      documentId: 'protocol-demo',
      expectedHash: contentHash,
      action: 'duplicate',
    });
    contentHash = mutation.structuredContent.contentHash;
    mutation = await call(client, 'edit_animation', {
      documentId: 'protocol-demo',
      expectedHash: contentHash,
      action: 'set-fps',
      fps: 6,
    });
    contentHash = mutation.structuredContent.contentHash;

    const staleMutation = await client.callTool({
      name: 'update_text',
      arguments: {
        documentId: 'protocol-demo',
        expectedHash: initialHash,
        layerId: 'layer-title',
        text: 'STALE WRITE',
      },
    });
    assert.equal(staleMutation.isError, true);
    assert.match(staleMutation.structuredContent?.error, /changed since it was read/);
    assert.equal(staleMutation.content[0].text, JSON.stringify(staleMutation.structuredContent, null, 2));

    const exportResult = await call(client, 'export_document', {
      documentId: 'protocol-demo',
      format: 'png',
      outputName: 'protocol-still',
      width: 320,
      height: 180,
    });
    const outputPath = exportResult.structuredContent?.outputPath;
    assert.equal(typeof outputPath, 'string');
    assert.equal(existsSync(outputPath), true);
    const metadata = await sharp(outputPath).metadata();
    assert.deepEqual([metadata.width, metadata.height], [320, 180]);

    const animationResult = await call(client, 'export_animation', {
      documentId: 'protocol-demo',
      format: 'gif',
      outputName: 'protocol-animation',
      width: 160,
      height: 90,
    });
    assert.equal(existsSync(animationResult.structuredContent?.outputPath), true);
    assert.equal(animationResult.structuredContent?.frameCount, 2);
    assert.equal(animationResult.structuredContent?.fps, 6);

    const documentResult = await call(client, 'get_document', {
      documentId: 'protocol-demo',
    });
    const document = documentResult.structuredContent?.document;
    assert.equal(document.frames.length, 2);
    assert.equal(documentResult.structuredContent?.summary.contentHash, contentHash);
    assert.equal(document.layers.find((layer) => layer.id === 'layer-title').text, 'FINAL CUT');
    assert.match(document.layers.find((layer) => layer.id === 'layer-support-main').src, /^\[embedded image:/);

    const duplicateExport = await client.callTool({
      name: 'export_document',
      arguments: {
        documentId: 'protocol-demo',
        format: 'png',
        outputName: 'protocol-still',
        width: 320,
        height: 180,
      },
    });
    assert.equal(duplicateExport.isError, true);
    assert.match(duplicateExport.content[0].text, /already exists/);

    const outsideFile = join(temporaryRoot, 'outside.png');
    const linkedExport = join(exportsDirectory, 'linked.png');
    writeFileSync(outsideFile, 'must remain unchanged');
    linkSync(outsideFile, linkedExport);
    await call(client, 'export_document', {
      documentId: 'protocol-demo',
      format: 'png',
      outputName: 'linked',
      overwrite: true,
      width: 320,
      height: 180,
    });
    assert.equal(readFileSync(outsideFile, 'utf8'), 'must remain unchanged');
    assert.equal((await sharp(linkedExport).metadata()).format, 'png');

    const traversal = await client.callTool({
      name: 'export_document',
      arguments: {
        documentId: 'protocol-demo',
        format: 'png',
        outputName: '../escape',
      },
    });
    assert.equal(traversal.isError, true);
    assert.equal(existsSync(join(temporaryRoot, 'escape.png')), false);

    const malformed = await client.callTool({
      name: 'create_document',
      arguments: { documentId: '../bad', name: 'Bad', kind: 'thumbnail' },
    });
    assert.equal(malformed.isError, true);

    const unknown = await client.callTool({ name: 'tool_that_does_not_exist', arguments: {} });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /not found|unknown/i);

    const persisted = JSON.parse(
      readFileSync(join(dataDirectory, 'documents', 'protocol-demo.imago.json'), 'utf8'),
    );
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(persisted.document.templateId, 'split-spotlight');
    assert.equal(serverStderr, '', 'successful MCP operation should not emit stderr noise');
  } finally {
    await client.close().catch(() => undefined);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
