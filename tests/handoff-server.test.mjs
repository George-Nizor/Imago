import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import test from 'node:test';
import { imagoMcpHandoffPlugin } from '../vite.config.ts';

function middlewareFor(dataDirectory) {
  const plugin = imagoMcpHandoffPlugin(dataDirectory);
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  assert.equal(typeof middleware, 'function');
  return middleware;
}

class TestResponse extends Writable {
  statusCode = 0;
  headers = new Map();
  chunks = [];

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), String(value));
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get body() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

test('source handoff middleware serves only exact bounded document IDs with safe headers', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'imago-handoff-'));
  const documentDirectory = join(temporaryRoot, 'documents');
  mkdirSync(documentDirectory, { recursive: true });
  const payload = '{"schemaVersion":1,"kind":"imago-document"}\n';
  writeFileSync(join(documentDirectory, 'safe-document.imago.json'), payload);
  const middleware = middlewareFor(temporaryRoot);

  try {
    const response = new TestResponse();
    let delegated = false;
    middleware(
      { url: '/__imago_mcp/document/safe-document?cache=no' },
      response,
      () => { delegated = true; },
    );
    await finished(response);
    assert.equal(delegated, false);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.body, payload);

    const missing = new TestResponse();
    middleware({ url: '/__imago_mcp/document/missing' }, missing, () => assert.fail('must handle exact route'));
    await finished(missing);
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(JSON.parse(missing.body), { error: 'Document not found' });

    let traversalDelegated = false;
    middleware(
      { url: '/__imago_mcp/document/%2e%2e%2fsecret' },
      new TestResponse(),
      () => { traversalDelegated = true; },
    );
    assert.equal(traversalDelegated, true);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
