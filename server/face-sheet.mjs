// Numbered contact sheets of face images, drawn with the normal renderer from a temporary page. Used for
// the classifier's batch, the planner's pack sheet and find_faces. Every string is escaped.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderHtml } from "./renderer.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * items: [{file, label?, caption?, tint?}] (file is an absolute image path). Cells are numbered from 1 in
 * order. Resolves true when `out` was written; false when the renderer is unavailable (a sheet is a help,
 * never required).
 */
export async function renderFaceSheet(config, items, { out, title = "", columns = 5, cell = 260, checker = true } = {}) {
  if (!items.length) return false;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "imago-faces-sheet-"));
  try {
    const cells = [];
    for (const [i, item] of items.entries()) {
      const name = `img-${i}${path.extname(item.file).toLowerCase()}`;
      await fs.copyFile(item.file, path.join(dir, name));
      cells.push(`<figure><div class="img"><img src="${name}" alt=""><b>${i + 1}</b></div><figcaption><span class="f">${esc(item.label ?? "")}</span><span>${esc(item.caption ?? "")}</span></figcaption></figure>`);
    }
    const cols = Math.max(1, Math.min(columns, items.length));
    const rows = Math.ceil(items.length / cols);
    const captionH = 52;
    const gap = 12;
    const head = title ? 56 : 12;
    const width = cols * cell + (cols + 1) * gap;
    const height = head + rows * (cell + captionH + gap) + gap;
    const ground = checker ? "background:#2b2b30 conic-gradient(#35353b 25%,#2b2b30 0 50%,#35353b 0 75%,#2b2b30 0) 0 0/28px 28px" : "background:#222";
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fonts/fonts.css"><style>
html,body{margin:0}
body{width:${width}px;height:${height}px;overflow:hidden;background:#15130f;color:#f2ede6;font-family:"Archivo",sans-serif}
h1{margin:0;padding:16px ${gap}px 0;font-size:22px;font-weight:700}
main{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:${gap}px;padding:${gap}px}
figure{margin:0;width:${cell}px;height:${cell + captionH}px}
.img{position:relative;width:${cell}px;height:${cell}px;${ground};border-radius:6px;overflow:hidden}
.img img{width:100%;height:100%;object-fit:contain;display:block}
.img b{position:absolute;left:6px;top:6px;background:#00bcab;color:#001b18;font-size:20px;min-width:28px;text-align:center;padding:1px 6px;border-radius:5px}
figcaption{display:flex;flex-direction:column;gap:2px;padding-top:5px;font-size:15px;line-height:1.2}
figcaption .f{font-weight:700}
figcaption span:last-child{opacity:.75}
</style></head><body>${title ? `<h1>${esc(title)}</h1>` : ""}<main>${cells.join("")}</main></body></html>`;
    const htmlFile = path.join(dir, "sheet.html");
    await fs.writeFile(htmlFile, html);
    await renderHtml(config, { htmlFile, width, height, scale: 1, format: "png", out });
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
