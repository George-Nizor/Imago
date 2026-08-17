import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ROOT, ensureDirs, PREFS_PATH } from './paths.js';

const execFileAsync = promisify(execFile);
const DEV_URL = process.env.IMAGO_URL ?? process.env.FRAMEKIT_URL ?? 'http://localhost:5173';
const PID_FILE = join(DATA_DIR, 'dev-server.pid');

async function isUp(url = DEV_URL): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export async function ensureDevServer(): Promise<{ url: string; started: boolean }> {
  ensureDirs();
  if (await isUp()) {
    return { url: DEV_URL, started: false };
  }

  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid));
  }

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await isUp()) return { url: DEV_URL, started: true };
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Imago dev server did not become ready in time');
}

export async function openInBrowser(url = DEV_URL): Promise<string> {
  const platform = process.platform;
  if (platform === 'darwin') {
    await execFileAsync('open', [url]);
  } else if (platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', url]);
  } else {
    await execFileAsync('xdg-open', [url]);
  }
  return url;
}

export async function openFile(path: string): Promise<string> {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  return openInBrowser(path);
}

export async function openImago(opts?: {
  startServer?: boolean;
  path?: 'home' | 'thumbnail' | 'title-card';
  documentId?: string;
}): Promise<{ url: string; started: boolean }> {
  let started = false;
  if (opts?.startServer !== false) {
    const s = await ensureDevServer();
    started = s.started;
  } else if (!(await isUp())) {
    throw new Error('Imago is not running. Call open_imago with startServer true.');
  }

  const hash = opts?.documentId
    ? `#handoff=${encodeURIComponent(opts.documentId)}`
    : opts?.path === 'thumbnail'
      ? '#workflow=thumbnail'
      : opts?.path === 'title-card'
        ? '#workflow=title-card'
        : '';
  const url = `${DEV_URL}${hash}`;
  await openInBrowser(url);
  return { url, started };
}

export function rememberLastExport(path: string) {
  ensureDirs();
  let prefs: Record<string, unknown> = {};
  try {
    if (existsSync(PREFS_PATH)) prefs = JSON.parse(readFileSync(PREFS_PATH, 'utf8'));
  } catch {
    /* ignore */
  }
  prefs.lastExport = path;
  writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
}
