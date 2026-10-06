// design.html rules (docs/redesign-contract.md). Deliberately a small tolerant scanner, not an
// HTML parser: errors must be ones Claude can act on, so anything doubtful is a warning.

const MAX_BYTES = 8 * 1024 * 1024;
// Matched wherever a tag name starts, whatever follows it (`<script/x>`, `<script\n>`, `< script>`).
const FORBIDDEN_TAG = /<\s*(\/?)\s*(script|iframe|object|embed|base|frame|frameset|applet|meta|link)\b[^>]*>?/gi;
// An on* attribute after whitespace, `/` or a quote, anywhere inside a tag (`<img/src=x/onerror=...>`).
const EVENT_HANDLER = /<\s*[a-zA-Z][^>]*?[\s/"']on[a-z]+\s*=/gi;
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "unset", "revert",
]);
const FONT_SHEET = "/fonts/fonts.css";
const URL_ATTRIBUTES = new Set(["src", "href", "xlink:href", "poster", "action", "formaction", "data", "background"]);

const TAG = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)((?:[\s/]+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributesOf(source) {
  const attrs = [];
  for (const m of source.matchAll(ATTRIBUTE)) attrs.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]);
  return attrs;
}

/** Returns a reason string if the URL is not allowed, else null. */
function urlProblem(value, { allowFontSheet = false } = {}) {
  const url = value.trim().replace(/^["']|["']$/g, "");
  if (!url || url.startsWith("#") || /^data:/i.test(url)) return null;
  if (/^javascript:/i.test(url)) return "javascript: URLs are not allowed";
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return "absolute and protocol-relative URLs are not allowed (there is no network); use assets/<file> or a data: URL";
  if (url === FONT_SHEET || (allowFontSheet && url.startsWith("/fonts/"))) return null;
  if (url.startsWith("/")) return "root-relative URLs are not allowed; use assets/<file>";
  if (url.split(/[\\/]/).includes("..")) return "paths must stay inside the project (no ..)";
  return null;
}

function cssUrls(css) {
  const urls = [];
  for (const m of css.matchAll(/url\(\s*("([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) urls.push(m[2] ?? m[3] ?? (m[4] ?? "").trim());
  return urls;
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function declarations(block) {
  const out = [];
  for (const part of block.split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out.push([part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).replace(/!important/i, "").trim()]);
  }
  return out;
}

function fontFamilies(value) {
  return value
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, "").trim())
    .filter((f) => f && !/^var\(/i.test(f));
}

const isZero = (tokens) => tokens.length > 0 && tokens.every((t) => /^0+(\.0+)?(px|em|rem|%)?$/.test(t));

/**
 * @param {string} html
 * @param {{width:number,height:number,fonts:string[]}} options
 * @returns {{errors:string[], warnings:string[]}}
 */
export function validateDesign(html, { width, height, fonts = [] }) {
  const errors = [];
  const warnings = [];
  const error = (m) => !errors.includes(m) && errors.push(m);
  const warn = (m) => !warnings.includes(m) && warnings.push(m);
  const known = new Set(fonts.map((f) => f.toLowerCase()));

  if (typeof html !== "string" || !html.trim()) return { errors: ["design.html is empty."], warnings };
  if (Buffer.byteLength(html) > MAX_BYTES) error("design.html is larger than 8 MB; shrink inline data.");

  // `<!-->` and `<!--->` are complete (empty) comments to a browser; the lazy match below would swallow what follows.
  const source = html.replace(/<!--(?:-?>)/g, "").replace(/<!--[\s\S]*?-->/g, "");
  if (!/<html[\s>]/i.test(source) || !/<body[\s>]/i.test(source)) error("design.html must be a complete document with <html> and <body>.");

  const css = [];
  let bodyStyle = "";
  let sheetLinked = false;

  for (const m of source.matchAll(FORBIDDEN_TAG)) {
    const [segment, closing, rawName] = m;
    const name = rawName.toLowerCase();
    if (name === "meta" && !closing) {
      if (/http-equiv/i.test(segment)) error("<meta http-equiv=...> (refresh and the like) is not allowed.");
    } else if (name === "link" && !closing) {
      const attrs = /^<\s*link\s/i.test(segment) ? attributesOf(segment.replace(/^<\s*link/i, "").replace(/>$/, "")) : [];
      const rel = attrs.find(([k]) => k === "rel")?.[1]?.toLowerCase();
      const href = attrs.find(([k]) => k === "href")?.[1];
      if (rel === "stylesheet" && href === FONT_SHEET) sheetLinked = true;
      else error(`The only <link> allowed is <link rel="stylesheet" href="${FONT_SHEET}">.`);
    } else error(`<${name}> is not allowed.`);
  }
  for (const m of source.matchAll(EVENT_HANDLER)) {
    const key = /[\s/"']on[a-z]+\s*=$/i.exec(m[0])?.[0].replace(/^[\s/"']|\s*=$/g, "").toLowerCase() ?? "on*";
    error(`Event handler attribute "${key}" is not allowed.`);
  }

  for (const m of source.matchAll(TAG)) {
    const [, closing, rawName, rawAttrs] = m;
    const name = rawName.toLowerCase();
    if (closing) continue;
    const attrs = attributesOf(rawAttrs);
    for (const [key, value] of attrs) {
      if (/^on[a-z]/.test(key)) error(`Event handler attribute "${key}" is not allowed.`);
      if (URL_ATTRIBUTES.has(key) && name !== "link") {
        const problem = urlProblem(value);
        if (problem) error(`${name} ${key}="${value.slice(0, 80)}": ${problem}.`);
      }
      if (key === "srcset") {
        for (const candidate of value.split(",")) {
          const problem = urlProblem(candidate.trim().split(/\s+/)[0] ?? "");
          if (problem) error(`${name} srcset: ${problem}.`);
        }
      }
      if (key === "style") {
        css.push(value);
        if (name === "body") bodyStyle = value;
      }
      if (key === "font-family") for (const f of fontFamilies(value)) if (!GENERIC_FAMILIES.has(f.toLowerCase()) && !known.has(f.toLowerCase())) warn(`Font family "${f}" is not in fonts.json and will fall back.`);
    }
  }
  for (const m of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) css.push(m[1]);

  const allCss = stripCssComments(css.join("\n"));
  if (/@import/i.test(allCss)) error("CSS @import is not allowed; use the font sheet link.");
  for (const url of cssUrls(allCss)) {
    const problem = urlProblem(url, { allowFontSheet: true });
    if (problem) error(`CSS url(${url.slice(0, 80)}): ${problem}.`);
  }
  if (/expression\s*\(|javascript:/i.test(allCss)) error("Script-like CSS is not allowed.");

  // body geometry: merge every rule that targets body (or html / *) in order.
  const merged = new Map();
  const apply = (decls) => {
    for (const [k, v] of decls) {
      merged.set(k, v);
    }
  };
  const sheet = allCss.replace(/@media[^{]*\{/gi, "").replace(/@(font-face|keyframes)[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/gi, "");
  for (const rule of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1].split(",").map((s) => s.trim().toLowerCase());
    if (selectors.includes("body")) apply(declarations(rule[2]));
    else if (selectors.includes("html") || selectors.includes("*")) {
      const decls = declarations(rule[2]).filter(([k]) => k === "margin" || k === "overflow" || k.startsWith("margin-"));
      apply(decls);
    }
  }
  apply(declarations(bodyStyle));

  const dim = (key, expected) => {
    const v = merged.get(key);
    const px = v && /^(-?[\d.]+)px$/.exec(v);
    if (!px) error(`body must have ${key}: ${expected}px (found ${v ?? "nothing"}).`);
    else if (Math.round(Number(px[1])) !== expected) error(`body ${key} is ${v} but must be exactly ${expected}px.`);
  };
  dim("width", width);
  dim("height", height);
  const margin = merged.get("margin");
  const sides = ["margin-top", "margin-right", "margin-bottom", "margin-left"].map((k) => merged.get(k));
  const marginOk = (margin && isZero(margin.split(/\s+/))) || sides.every((v) => v && isZero([v]));
  if (!marginOk) error("body must have margin: 0.");
  const overflow = merged.get("overflow") ?? merged.get("overflow-x");
  if (!overflow || !/hidden|clip/.test(overflow)) error("body must have overflow: hidden.");

  for (const m of allCss.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const f of fontFamilies(m[1])) if (!GENERIC_FAMILIES.has(f.toLowerCase()) && !known.has(f.toLowerCase())) warn(`Font family "${f}" is not in fonts.json and will fall back.`);
  }
  for (const m of allCss.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}]+)/gi)) {
    // Shorthand: the family list is whatever follows the size, at the end.
    const tail = m[1].replace(/^.*?\d+(?:\.\d+)?(?:px|pt|em|rem|%)(?:\s*\/\s*[\d.]+(?:px|pt|em|rem|%)?)?\s+/i, "");
    if (tail !== m[1]) for (const f of fontFamilies(tail)) if (!GENERIC_FAMILIES.has(f.toLowerCase()) && !known.has(f.toLowerCase())) warn(`Font family "${f}" is not in fonts.json and will fall back.`);
  }
  if (!sheetLinked && known.size && [...allCss.matchAll(/font-family\s*:\s*([^;}]+)/gi)].some((m) => fontFamilies(m[1]).some((f) => known.has(f.toLowerCase())))) {
    warn(`Content fonts are used but <link rel="stylesheet" href="${FONT_SHEET}"> is missing.`);
  }
  return { errors, warnings };
}
