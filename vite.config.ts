import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createReadStream, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const ortRuntime = fileURLToPath(
  new URL('./node_modules/onnxruntime-web/dist/ort.bundle.min.mjs', import.meta.url),
);

export function imagoMcpHandoffPlugin(
  dataDirectory = resolve(process.env.IMAGO_DATA_DIR ?? fileURLToPath(new URL('./.imago', import.meta.url))),
): Plugin {
  return {
    name: 'imago-mcp-handoff',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        const match = /^\/__imago_mcp\/document\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(pathname);
        if (!match) return next();
        const filePath = join(dataDirectory, 'documents', `${match[1]}.imago.json`);
        try {
          const info = lstatSync(filePath);
          if (!info.isFile() || info.size <= 0 || info.size > 128 * 1024 * 1024) throw new Error('invalid');
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          createReadStream(filePath).pipe(response);
        } catch {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end('{"error":"Document not found"}');
        }
      });
    },
  };
}

export default defineConfig({
  // Relative assets let the production build run inside Instrumenta's local
  // Chromium window as well as from a conventional web server.
  base: './',
  plugins: [react(), imagoMcpHandoffPlugin()],
  resolve: {
    alias: [
      // onnxruntime-web 1.21 publishes `ort.bundle` and `ort.webgpu.bundle`,
      // but those modules are identical except for their self/worker filename.
      // The default module already registers WebGPU and WASM, so resolving both import specifiers to one canonical module here preserves GPU selection and CPU fallback without
      // shipping the same main-thread + pthread-worker runtime twice.
      { find: /^onnxruntime-web(?:\/webgpu)?$/, replacement: ortRuntime },
    ],
  },
  optimizeDeps: {
    exclude: ['@imgly/background-removal'],
  },
  worker: {
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
