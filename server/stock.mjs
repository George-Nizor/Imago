// Stock images for "Take it further" turns: an Openverse search and a guarded download into assets/.
// The download is the risky part (a model chooses the URL), so every hop is https-only and must
// resolve to public addresses, and the bytes must be a real image before they are written.
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { EXTENSION, MAX_PIXELS, imageInfo, tooManyPixels } from "./image-info.mjs";
import { isSafeLeaf, sanitizeLeaf } from "./paths.mjs";

// The default 250 ms IPv4 fallback budget is too short for some CDNs.
net.setDefaultAutoSelectFamilyAttemptTimeout(4000);

export const MAX_STOCK_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;
const OPENVERSE = "https://api.openverse.org/v1/images/";
const UA = "Mozilla/5.0 (compatible; Imago/0.2; +https://github.com/) stock-image-fetch";

export class StockError extends Error {}

// ---- address checks -----------------------------------------------------------------------

function v4Private(a, b) {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function expandV6(ip) {
  let text = ip.split("%")[0].toLowerCase();
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [x, y, z, w] = tail.slice(1).map(Number);
    text = text.slice(0, tail.index) + ((x << 8) | y).toString(16) + ":" + ((z << 8) | w).toString(16);
  }
  const [head, rest] = text.split("::");
  const h = head ? head.split(":") : [];
  const r = rest === undefined ? [] : rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(Math.max(0, 8 - h.length - r.length)).fill("0");
  return [...h, ...fill, ...r].map((g) => parseInt(g || "0", 16));
}

/** True for loopback, private, link-local, CGNAT, multicast, unspecified and reserved addresses. */
export function isPrivateAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return v4Private(a, b);
  }
  if (kind === 6) {
    const g = expandV6(ip);
    if (g.length !== 8 || g.some((n) => !Number.isFinite(n))) return true;
    if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return v4Private(g[6] >> 8, g[6] & 255); // ::ffff:a.b.c.d and ::a.b.c.d (also ::, ::1)
    if (g[0] === 0x64 && g[1] === 0xff9b) return v4Private(g[6] >> 8, g[6] & 255); // NAT64
    if (g[0] === 0x2002) return v4Private(g[1] >> 8, g[1] & 255); // 6to4
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00 || g.every((n) => n === 0);
  }
  return true; // not an IP at all: refuse
}

/** Parses and vets one URL: https, no credentials, port 443, and only public addresses behind it. */
export async function assertPublicHttps(raw, lookup = (host) => dns.lookup(host, { all: true })) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new StockError("That is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new StockError(`Only https URLs can be fetched (got ${url.protocol.replace(":", "")}).`);
  if (url.username || url.password) throw new StockError("URLs with credentials are refused.");
  if (url.port && url.port !== "443") throw new StockError("Only the standard https port is allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new StockError("That host is not a public site.");
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host).catch(() => { throw new StockError(`Could not resolve ${host}.`); });
  if (!addresses.length) throw new StockError(`Could not resolve ${host}.`);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new StockError("That host resolves to a private or loopback address.");
  return url;
}

// ---- download -----------------------------------------------------------------------------

async function readCapped(res, limit) {
  const declared = Number(res.headers.get("content-length"));
  if (declared > limit) throw new StockError(`The image is larger than ${Math.round(limit / 1048576)} MB.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) throw new StockError(`The image is larger than ${Math.round(limit / 1048576)} MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Downloads `rawUrl`, following redirects only to vetted https URLs. Returns {bytes, url}. */
export async function download(rawUrl, { fetchImpl = fetch, lookup, limit = MAX_STOCK_BYTES } = {}) {
  let url = await assertPublicHttps(rawUrl, lookup);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetchImpl(url.href, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "image/png,image/jpeg,image/webp,image/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error) => {
      throw new StockError(`Could not download the image: ${error.name === "TimeoutError" ? "timed out" : (error.cause?.code ?? error.message)}`);
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel?.().catch(() => {});
      if (!location) throw new StockError("A redirect had no target.");
      url = await assertPublicHttps(new URL(location, url).href, lookup);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel?.().catch(() => {});
      throw new StockError(`The server answered ${res.status}.`);
    }
    return { bytes: await readCapped(res, limit), url: url.href };
  }
  throw new StockError("Too many redirects.");
}

/** Bytes of a PNG, JPEG or WebP as they are; GIF, AVIF, TIFF and HEIF become PNG when sharp is available. */
export async function normaliseImage(bytes) {
  const info = imageInfo(bytes);
  if (info) {
    if (tooManyPixels(info)) throw new StockError(`The image is larger than ${MAX_PIXELS / 1_000_000} megapixels.`);
    return { bytes, info };
  }
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new StockError("That is not a PNG, JPEG or WebP image, and no converter is installed.");
  }
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!["gif", "avif", "heif", "tiff"].includes(meta.format)) throw new Error("unsupported");
    const png = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).png().toBuffer();
    const out = imageInfo(png);
    if (out) return { bytes: png, info: out };
  } catch {
    // Falls through to the refusal.
  }
  throw new StockError("That is not a usable image (PNG, JPEG, WebP, GIF or AVIF).");
}

/** Writes `bytes` under the first free name (wanted, wanted-2, ...); "wx" makes the claim atomic. */
async function writeUnique(dir, wanted, bytes) {
  const ext = path.extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? wanted : `${stem}-${n}${ext}`;
    try {
      await fs.writeFile(path.join(dir, name), bytes, { flag: "wx" });
      return name;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

/** A license link is kept only when it is http(s); anything else (javascript:, data:, ...) is dropped. */
export function httpUrlOnly(value, max = 300) {
  const raw = typeof value === "string" ? value.trim().slice(0, max) : "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? raw : "";
  } catch {
    return "";
  }
}

const clip = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** The fetch_image tool: download, verify, save under assets/, write the credit sidecar. */
export async function fetchStockImage(projectDir, { url, credit, license, licenseUrl, source }, deps = {}) {
  const got = await download(url, deps);
  const { bytes, info } = await normaliseImage(got.bytes);
  const dir = path.join(projectDir, "assets");
  await fs.mkdir(dir, { recursive: true });
  const leaf = decodeURIComponent(new URL(got.url).pathname.split("/").pop() || "").replace(/\.[^.]*$/, "");
  const stem = sanitizeLeaf(leaf, "image").replace(/\.[^.]*$/, "").replace(/\.+/g, "-").slice(0, 40) || "image";
  const wanted = `stock-${stem}.${EXTENSION[info.type]}`;
  const name = await writeUnique(dir, isSafeLeaf(wanted) ? wanted : `stock-image.${EXTENSION[info.type]}`, bytes);
  const sidecar = {
    url: got.url,
    credit: clip(credit, 300),
    license: clip(license, 100),
    licenseUrl: httpUrlOnly(licenseUrl),
    source: clip(source, 300),
    fetchedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, `${name}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
  return { name, width: info.width, height: info.height };
}

// ---- search -------------------------------------------------------------------------------

const licenseLabel = (license, version) => {
  const code = String(license ?? "").toLowerCase();
  if (!code) return "";
  const label = code === "cc0" ? "CC0" : code === "pdm" ? "Public Domain Mark" : `CC ${code.toUpperCase()}`;
  return version && code !== "pdm" ? `${label} ${version}` : label;
};

/** Maps an Openverse result to the compact row the model sees. */
export function mapOpenverseResult(r) {
  return {
    id: r.id,
    title: clip(r.title, 120),
    url: r.url,
    thumbnail: r.thumbnail,
    width: r.width ?? null,
    height: r.height ?? null,
    creator: clip(r.creator, 120) || "unknown",
    license: licenseLabel(r.license, r.license_version),
    license_url: httpUrlOnly(r.license_url),
    source: clip(r.source ?? r.provider, 60),
  };
}

export async function searchImages({ query, count = 8 }, { fetchImpl = fetch } = {}) {
  const q = clip(query, 200);
  if (!q) throw new StockError("query is required.");
  const size = Math.min(Math.max(Math.round(Number(count) || 8), 1), 20);
  const params = new URLSearchParams({ q, license_type: "commercial,modification", page_size: String(size), mature: "false" });
  const res = await fetchImpl(`${OPENVERSE}?${params}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch((error) => {
    throw new StockError(`Openverse did not answer (${error.name === "TimeoutError" ? "timed out" : error.message}). Try again, or use WebSearch to find an image.`);
  });
  if (!res.ok) throw new StockError(`Openverse answered ${res.status}.`);
  const data = await res.json().catch(() => ({}));
  return (data.results ?? []).map(mapOpenverseResult);
}
