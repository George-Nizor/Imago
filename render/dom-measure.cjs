"use strict";

// Runs inside the design page (serialised by render.cjs): lists the visible text and the images with
// their boxes and computed styles. It must not refer to anything outside its own body.
function domMeasure() {
  const W = document.body.clientWidth || window.innerWidth;
  const H = document.body.clientHeight || window.innerHeight;
  const parse = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const canvas = document.createElement("canvas").getContext("2d");
  const capHeight = (style) => {
    try {
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const ascent = canvas.measureText("H").actualBoundingBoxAscent;
      if (ascent > 0) return ascent;
    } catch {
      // Falls back to a typical cap-height ratio below.
    }
    return parseFloat(style.fontSize) * 0.7;
  };
  const effectiveOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const hidden = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return true;
    }
    return false;
  };

  const blocks = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || /^(SCRIPT|STYLE|TITLE|NOSCRIPT)$/i.test(el.tagName) || !node.nodeValue.trim()) continue;
    if (hidden(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(W, r.right), y1 = Math.min(H, r.bottom);
    if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) < 0.5 * r.width * r.height) continue; // mostly off the canvas
    const style = getComputedStyle(el);
    const opacity = effectiveOpacity(el);
    if (opacity < 0.05) continue;
    const words = node.nodeValue.split(/\s+/).map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
    if (!words.length) continue;
    const svg = el instanceof SVGElement;
    const fill = svg ? parse(style.fill) : parse(style.webkitTextFillColor) || parse(style.color);
    const strokeWidth = svg ? parseFloat(style.strokeWidth) || 0 : parseFloat(style.webkitTextStrokeWidth) || 0;
    blocks.push({
      words,
      rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      fontSize: parseFloat(style.fontSize),
      capHeight: capHeight(style),
      color: fill,
      opacity,
      outlined: strokeWidth >= 1 || (style.textShadow && style.textShadow !== "none"),
    });
  }

  const images = [...document.images].filter((img) => !hidden(img)).map((img) => {
    const r = img.getBoundingClientRect();
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(W, r.right), y1 = Math.min(H, r.bottom);
    return {
      src: img.getAttribute("src") || "",
      rect: { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) },
      cutout: /cutout/i.test(img.getAttribute("src") || ""),
      opacity: effectiveOpacity(img),
    };
  }).filter((img) => img.rect.w > 1 && img.rect.h > 1 && img.opacity >= 0.05);

  return { canvas: { w: W, h: H }, blocks, images };
}

module.exports = { domMeasure };
