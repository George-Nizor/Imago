"use strict";

// design.html -> png | jpg | webp, in a hidden Electron window.
//
//   electron --no-sandbox --no-zygote render/render.cjs --html=<file> --width=1280 --height=720 \
//     [--scale=1] [--format=png|jpg|webp] --out=<file> --fonts=<dir> [--measure] [--feed=<job.json>]
//
// Every request is refused except file:// inside the page's folder and /fonts/ mapped to --fonts,
// so a design cannot reach the network or the rest of the disk. Prints one JSON line on success.
//
// --measure adds `measure` to that line: the visible text and images (DOM), the contrast behind each
// text block (a second capture with the text hidden) and statistics of the render at feed size.
// --feed=<job.json> then renders a staged feed page ({dir, width, out, neighbours: [{file?, meanLab?}]})
// in the same process, under the same sandbox with its own folder as the only readable one, after
// copying the render into it as thumb.png.

const { app, BrowserWindow, protocol, net, session, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { domMeasure } = require("./dom-measure.cjs");
const { backdropLuminance, pixelStats } = require("./measure.cjs");

if (!app.commandLine.hasSwitch("no-zygote")) {
  console.error("run with --no-sandbox --no-zygote");
  app.exit(2);
}
// Nothing is shown. Without a display Chromium must be told on the command line to go headless
// (the ozone switch is also passed by the caller); this covers the in-process case.
app.commandLine.appendSwitch("disable-gpu");
if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) app.commandLine.appendSwitch("ozone-platform", "headless");

// Closing the design window before the feed one opens must not end the process.
app.on("window-all-closed", () => {});

const flag = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const htmlFile = path.resolve(flag("html") ?? "");
const width = Math.round(Number(flag("width")));
const height = Math.round(Number(flag("height")));
const scale = Number(flag("scale") ?? 1);
const format = flag("format") ?? "png";
const outFile = path.resolve(flag("out") ?? "");
const fontsDir = path.resolve(flag("fonts") ?? "");
// The one folder the page being rendered may read; the feed page swaps in its own after the design is done.
let pageDir = fs.realpathSync(path.dirname(htmlFile));
const wantMeasure = process.argv.includes("--measure");
const feedJob = flag("feed") ? JSON.parse(fs.readFileSync(path.resolve(flag("feed")), "utf8")) : null;
const STATS_WIDTH = 320; // "feed size": statistics are taken on a copy this wide
const JPEG_QUALITY = 92; // Electron takes 0-100: this is 0.92
// The design document is served with no script-src at all (default-src 'none'), so a script the
// validator missed still cannot run. Fonts and images come from file: (the project and /fonts/).
const DESIGN_CSP = "default-src 'none'; img-src file: data:; style-src 'unsafe-inline' file:; font-src file: data:; base-uri 'none'; form-action 'none'";

function fail(message, code = 1) {
  console.error(message);
  app.exit(code);
}

const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

function resolveRequest(url) {
  let target;
  try {
    target = fileURLToPath(url);
  } catch {
    return null;
  }
  const normalized = target.split(path.sep).join("/");
  if (normalized.startsWith("/fonts/")) target = path.join(fontsDir, normalized.slice("/fonts/".length));
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return null;
  }
  const allowed = inside(pageDir, real) || inside(fontsDir, real);
  return allowed ? real : null;
}

async function main() {
  if (!(width > 0 && height > 0 && scale > 0 && ["png", "jpg", "webp"].includes(format))) return fail("bad arguments");
  if (!fs.existsSync(htmlFile)) return fail(`no such file: ${htmlFile}`);

  // `file` is handled here so /fonts/... and the folder sandbox apply to the page and its assets.
  protocol.handle("file", (request) => {
    const real = resolveRequest(request.url);
    if (!real) return new Response("blocked", { status: 403 });
    return net.fetch(pathToFileURL(real).toString(), { bypassCustomProtocolHandlers: true }).then((response) => {
      if (!/\.html?$/i.test(real)) return response;
      const headers = new Headers(response.headers);
      headers.set("content-security-policy", DESIGN_CSP);
      return new Response(response.body, { status: response.status, headers });
    });
  });
  // Anything else (http, https, ws, ftp, ...) is cancelled; data: and blob: stay inside the page.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(file|data|blob|devtools):/i.test(details.url) });
  });

  const win = new BrowserWindow({
    show: false,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    useContentSize: true,
    frame: false,
    transparent: false,
    backgroundColor: format === "png" ? "#00000000" : "#ffffffff",
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false, webSecurity: true, disableBlinkFeatures: "WebRTC" },
  });
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  await win.loadURL(pathToFileURL(htmlFile).toString());
  // Page zoom, not Electron's device emulation (which crashes offscreen): the viewport stays
  // width x height CSS px while the window, and so the capture, is `scale` times denser. Applied
  // after the load because the zoom level belongs to the loaded origin.
  contents.setZoomFactor(scale);
  await contents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
    await Promise.all([...document.images].map((img) => img.decode ? img.decode().catch(() => {}) : null));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  if (!contents.isPainting()) contents.startPainting();
  await new Promise((r) => setTimeout(r, 120));

  let image = await contents.capturePage();
  const size = image.getSize();
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);
  if (size.width !== targetW || size.height !== targetH) image = image.resize({ width: targetW, height: targetH, quality: "best" });

  let bytes;
  if (format === "png") bytes = image.toPNG();
  else if (format === "jpg") bytes = image.toJPEG(JPEG_QUALITY);
  else {
    // nativeImage has no WebP encoder; the page's own canvas does.
    const png = image.toPNG().toString("base64");
    const b64 = await contents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c.toDataURL("image/webp", 0.92).split(",")[1]);
      };
      img.onerror = () => reject(new Error("webp encode failed"));
      img.src = "data:image/png;base64,${png}";
    })`);
    bytes = Buffer.from(b64, "base64");
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, bytes);
  const final = image.getSize();
  const result = { ok: true, width: final.width, height: final.height, bytes: bytes.length };
  // The design is already on disk: a failure past this point costs the extras, not the render.
  if (wantMeasure) {
    try {
      result.measure = await measureDesign(contents, image);
    } catch (error) {
      result.measureError = String(error?.message ?? error);
    }
  }
  if (feedJob) {
    win.destroy();
    try {
      result.feed = await renderFeed(feedJob);
    } catch (error) {
      result.feedError = String(error?.message ?? error);
    }
  }
  console.log(JSON.stringify(result));
  app.exit(0);
}

const bitmapOf = (image, width) => {
  const small = image.getSize().width > width ? image.resize({ width, quality: "good" }) : image;
  const { width: w, height: h } = small.getSize();
  return { bitmap: small.toBitmap(), w, h };
};

const nextFrames = (contents) => contents.executeJavaScript("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");

/** DOM boxes, the backdrop behind each text block and whole-image statistics. */
async function measureDesign(contents, image) {
  const dom = await contents.executeJavaScript(`(${domMeasure.toString()})()`);
  const size = image.getSize();
  const k = size.width / dom.canvas.w; // capture pixels per CSS pixel
  if (dom.blocks.length) {
    // Same page with every glyph made invisible: what is left is what the text sits on.
    const key = await contents.insertCSS("*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important}text,tspan{fill:transparent!important;stroke:none!important}");
    await nextFrames(contents);
    await new Promise((r) => setTimeout(r, 30));
    const bare = await contents.capturePage();
    await contents.removeInsertedCSS(key);
    const full = { bitmap: bare.toBitmap(), ...bare.getSize() };
    for (const block of dom.blocks) {
      block.backdrop = backdropLuminance(full.bitmap, full.width, full.height, { x: block.rect.x * k, y: block.rect.y * k, w: block.rect.w * k, h: block.rect.h * k });
    }
  }
  const { bitmap, w, h } = bitmapOf(image, STATS_WIDTH);
  return { ...dom, pixels: pixelStats(bitmap, w, h) };
}

/** Lab mean of an image file at thumbnail size, for the feed.distinct check. */
function meanLabOf(file) {
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) return null;
  const { bitmap, w, h } = bitmapOf(image, 64);
  return pixelStats(bitmap, w, h).meanLab;
}

async function renderFeed(job) {
  const dir = fs.realpathSync(path.resolve(job.dir));
  fs.copyFileSync(outFile, path.join(dir, "thumb.png"));
  const neighbours = job.neighbours.map((n) => ({ meanLab: n.meanLab ?? (n.file ? meanLabOf(path.join(dir, n.file)) : null) }));
  pageDir = dir;
  const win = new BrowserWindow({
    show: false,
    width: job.width,
    height: 4000, // taller than any feed; the capture is cropped to the page
    useContentSize: true,
    frame: false,
    backgroundColor: "#ffffffff",
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false, webSecurity: true, disableBlinkFeatures: "WebRTC" },
  });
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  await win.loadURL(pathToFileURL(path.join(dir, "index.html")).toString());
  const pageHeight = await contents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode ? img.decode().catch(() => {}) : null));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.ceil(document.body.getBoundingClientRect().height);
  })()`);
  if (!contents.isPainting()) contents.startPainting();
  await new Promise((r) => setTimeout(r, 80));
  const shot = await contents.capturePage({ x: 0, y: 0, width: job.width, height: Math.min(pageHeight, 4000) });
  fs.mkdirSync(path.dirname(path.resolve(job.out)), { recursive: true });
  fs.writeFileSync(path.resolve(job.out), shot.toPNG());
  win.destroy();
  return { width: shot.getSize().width, height: shot.getSize().height, neighbours };
}

app.whenReady().then(main).catch((error) => fail(`render failed: ${error?.stack ?? error}`));
// A design that never settles must not hang the caller (which also has its own timeout).
setTimeout(() => fail("render timed out", 3), 40_000).unref();
