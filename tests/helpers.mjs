import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { LOCAL_CHROMIUM_LIBS, loadConfig } from "../server/config.mjs";
import { createServer } from "../server/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_CLAUDE = path.join(here, "fixtures", "fake-claude.mjs");

// A WSL image without Chromium's libraries prefers tools/chromium-libs (npm run setup:libs) and only then borrows Fabula's.
const BORROWED_LIBS = path.resolve(here, "../../Fabula/tools/wsl-libs/usr/lib/x86_64-linux-gnu");

// Every temp dir a test makes is removed when the test process exits, pass or fail.
const made = [];
process.on("exit", () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "imago-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** A server on an ephemeral port, its own data dir and the fake claude. */
export async function startApp(overrides = {}) {
  const env = { ...process.env };
  if (!env.IMAGO_CHROMIUM_LIBS && fs.existsSync(LOCAL_CHROMIUM_LIBS)) env.IMAGO_CHROMIUM_LIBS = LOCAL_CHROMIUM_LIBS;
  else if (!env.IMAGO_CHROMIUM_LIBS && fs.existsSync(BORROWED_LIBS)) env.IMAGO_CHROMIUM_LIBS = BORROWED_LIBS;
  const dataDir = tempDir();
  const config = loadConfig(env, { dataDir, claudeBin: FAKE_CLAUDE, ...overrides });
  config.projectsDir = path.join(config.dataDir, "projects");
  const app = createServer(config);
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  return {
    app,
    base,
    dataDir,
    config,
    async close() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
    async api(method, url, body) {
      const res = await fetch(base + url, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const type = res.headers.get("content-type") ?? "";
      return { status: res.status, body: type.includes("json") ? await res.json() : await res.arrayBuffer() };
    },
  };
}

/** Reads the project's SSE stream until `until(event)` is true; resolves every event seen. */
export async function collectEvents(base, id, until, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${base}/api/projects/${id}/events`, { signal: controller.signal });
  const events = [];
  let buffer = "";
  const decoder = new TextDecoder();
  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const name = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (!name) continue;
        const event = { event: name, data: JSON.parse(data) };
        events.push(event);
        if (until(event)) return events;
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

/** Opens the stream, runs `act`, and returns the events up to `until`. */
export async function eventsDuring(base, id, act, until, timeoutMs) {
  const pending = collectEvents(base, id, until, timeoutMs);
  // The snapshot proves the subscription is live before anything is started.
  await new Promise((r) => setTimeout(r, 150));
  await act();
  return pending;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

/** A solid-colour RGB PNG. */
export function makePng(width, height, [r, g, b] = [200, 60, 60]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
