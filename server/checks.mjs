// The checks returned after every render: pure functions over what render.cjs measured (text boxes,
// computed styles, the backdrop behind each text block, statistics at feed size). They never block a
// render and each message is one short, actionable sentence because Claude reads them.
import { createRequire } from "node:module";

const { contrastRatio, deltaE, relativeLuminance } = createRequire(import.meta.url)("../render/measure.cjs");

/** Every threshold in one place; docs/redesign-contract.md explains each. */
export const LIMITS = {
  maxWords: { video: 5, podcast: 5, shorts: 4 },
  repeatsTitleShare: 0.6,
  // Width in CSS px of the smallest place a thumbnail of this format is shown.
  smallestSurface: { video: 168, shorts: 120, podcast: 96 },
  capHeightFloorPx: 7,
  contrastFloor: 3,
  contrastFloorOutlined: 2,
  subjectMinShare: { video: 0.5, shorts: 0.4, podcast: 0.5 },
  subjectGoodShare: 0.6,
  // Fractions of the canvas.
  badgeZone: { x: 0.85, y: 0.87 },
  badgeTextOverlap: 0.1,
  badgeSubjectOverlap: 0.3,
  crop34: { top: 0.125, bottom: 0.875 },
  rail: { x: 0.85, top: 0.42, bottom: 0.8 },
  caption: { top: 0.78, right: 0.8 },
  luminanceBand: [0.55, 0.95],
  colourful: { muted: 15, good: 33 },
  blendsIn: 18,
};

export const STOPWORDS = new Set("a an and the of to in on for with is are was be it this that at by or as from your you my our how why what".split(" "));
export const tokenize = (text) =>
  String(text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const pct = (n) => `${Math.round(n * 100)}%`;
const quote = (block) => `"${block.words.slice(0, 3).join(" ")}"`;
const check = (id, level, value, message) => ({ id, level, value, message });

/** Fraction of `a`'s area that lies inside `b` (rects {x,y,w,h}). */
export function overlapShare(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 && a.w * a.h > 0 ? (w * h) / (a.w * a.h) : 0;
}

const subjectsOf = (images) => images.filter((i) => i.cutout);

function textChecks(format, titleWords, blocks) {
  const out = [];
  const words = blocks.flatMap((b) => b.words);
  const max = LIMITS.maxWords[format];
  out.push(
    words.length > max
      ? check("text.words", "warn", words.length, `${words.length} words; keep it to ${max} or fewer. Cut the rest.`)
      : check("text.words", "ok", words.length, words.length ? `${words.length} words.` : "No text on the design."),
  );

  const content = words.filter((w) => !STOPWORDS.has(w));
  const same = content.filter((w) => titleWords.has(w));
  const share = content.length ? same.length / content.length : 0;
  out.push(
    content.length >= 2 && share >= LIMITS.repeatsTitleShare
      ? check("text.repeatsTitle", "warn", round(share), `${pct(share)} of the text repeats the video title. Add something the title does not say, or drop it.`)
      : check("text.repeatsTitle", "ok", round(share), content.length ? `${pct(share)} of the text repeats the title.` : "No text to compare with the title."),
  );

  const surface = LIMITS.smallestSurface[format];
  const sized = blocks.map((b) => ({ b, cap: b.capHeight * (surface / b.canvasWidth) })).sort((x, y) => x.cap - y.cap);
  if (!sized.length) {
    out.push(check("text.smallest", "info", null, "No text, nothing to size."));
  } else {
    const { b, cap } = sized[0];
    if (cap < LIMITS.capHeightFloorPx) {
      const wanted = Math.ceil((b.fontSize * LIMITS.capHeightFloorPx) / cap);
      out.push(check("text.smallest", "warn", round(cap, 1), `${quote(b)} is ${round(cap, 1)} px tall at ${surface} px wide (floor ${LIMITS.capHeightFloorPx}). Make it at least ${wanted}px, or cut it.`));
    } else {
      out.push(check("text.smallest", "ok", round(cap, 1), `Smallest text is ${round(cap, 1)} px tall at ${surface} px wide.`));
    }
  }

  const measured = blocks
    .filter((b) => b.backdrop != null && b.color)
    .map((b) => {
      const a = Math.min(1, (b.color[3] ?? 1) * (b.opacity ?? 1));
      const text = relativeLuminance(b.color[0], b.color[1], b.color[2]);
      const ratio = contrastRatio(a * text + (1 - a) * b.backdrop, b.backdrop);
      return { b, ratio, floor: b.outlined ? LIMITS.contrastFloorOutlined : LIMITS.contrastFloor };
    })
    .sort((x, y) => x.ratio / x.floor - y.ratio / y.floor);
  if (!measured.length) {
    out.push(check("text.contrast", "info", null, "No plain text to measure."));
  } else {
    const { b, ratio, floor } = measured[0];
    out.push(
      ratio < floor
        ? check("text.contrast", "warn", round(ratio, 1), `${quote(b)} has ${round(ratio, 1)}:1 contrast with what is behind it (floor ${floor}:1). Darken or lighten the backdrop, change the colour, or add a stroke.`)
        : check("text.contrast", "ok", round(ratio, 1), `Weakest text contrast is ${round(ratio, 1)}:1.`),
    );
  }
  return out;
}

function layoutChecks(format, blocks, images, w, h) {
  const subjects = subjectsOf(images);
  if (format === "video") {
    const zone = { x: LIMITS.badgeZone.x * w, y: LIMITS.badgeZone.y * h, w: (1 - LIMITS.badgeZone.x) * w, h: (1 - LIMITS.badgeZone.y) * h };
    const text = blocks.find((b) => overlapShare(b.rect, zone) >= LIMITS.badgeTextOverlap);
    const subject = subjects.find((s) => overlapShare(zone, s.rect) >= LIMITS.badgeSubjectOverlap);
    const where = `the bottom-right ${pct(1 - LIMITS.badgeZone.x)} by ${pct(1 - LIMITS.badgeZone.y)} (the duration badge)`;
    if (text) return [check("layout.badge", "warn", false, `${quote(text)} sits under the duration badge. Keep ${where} clear.`)];
    if (subject) return [check("layout.badge", "warn", false, `The cut-out reaches the duration badge. Keep ${where} clear of the subject.`)];
    return [check("layout.badge", "ok", true, "Duration badge zone is clear.")];
  }
  if (format === "shorts") {
    const { crop34, rail, caption } = LIMITS;
    for (const b of blocks) {
      const r = b.rect;
      if (r.y < crop34.top * h || r.y + r.h > crop34.bottom * h) return [check("layout.safe", "warn", false, `${quote(b)} falls outside the 3:4 profile-grid crop (keep text between ${pct(crop34.top)} and ${pct(crop34.bottom)} of the height).`)];
      if (r.x + r.w > rail.x * w && r.y + r.h > rail.top * h && r.y < rail.bottom * h) return [check("layout.safe", "warn", false, `${quote(b)} is under the right-hand action buttons (right ${pct(1 - rail.x)}, ${pct(rail.top)} to ${pct(rail.bottom)} down).`)];
      if (r.y + r.h > caption.top * h && r.x < caption.right * w) return [check("layout.safe", "warn", false, `${quote(b)} is under the caption block (bottom ${pct(1 - caption.top)}).`)];
    }
    const cropped = subjects.find((s) => s.rect.y < crop34.top * h - 1);
    if (cropped) return [check("layout.safe", "warn", false, `The cut-out's top is cropped in 3:4 profile grids. Start the head below ${pct(crop34.top)} of the height.`)];
    return [check("layout.safe", "ok", true, "Text and subject sit inside the 3:4 crop and clear of the overlays.")];
  }
  return [];
}

function subjectCheck(format, images, h) {
  const subjects = subjectsOf(images);
  if (!subjects.length) return check("subject.size", "info", null, "No cut-out subject.");
  const share = Math.max(...subjects.map((s) => s.rect.h)) / h;
  const min = LIMITS.subjectMinShare[format];
  return share < min
    ? check("subject.size", "warn", round(share), `The subject is ${pct(share)} of the height; make it ${pct(LIMITS.subjectGoodShare)} or more so it reads at feed size.`)
    : check("subject.size", "ok", round(share), `The subject is ${pct(share)} of the height.`);
}

function pixelChecks(pixels) {
  const [lo, hi] = LIMITS.luminanceBand;
  const spread = pixels.spread;
  const tone = spread < lo ? `Flat at feed size; push the lights and darks apart (aim ${lo} to ${hi}).` : spread > hi ? `Very stark (aim ${lo} to ${hi}); check nothing clips.` : `Within ${lo} to ${hi}.`;
  const m = pixels.colourfulness;
  const { muted, good } = LIMITS.colourful;
  const hue = m < muted ? "Muted; a stronger accent colour would stand out." : m < good ? "Moderate." : "Vivid.";
  return [
    check("image.contrast", "info", round(spread), `Luminance spread ${round(spread)}. ${tone}`),
    check("image.colourfulness", "info", round(m, 1), `Colourfulness ${round(m, 1)}. ${hue}`),
  ];
}

function distinctCheck(pixels, neighbours) {
  const labs = (neighbours?.labs ?? []).filter(Boolean);
  if (!labs.length) return check("feed.distinct", "info", null, "No neighbours to compare with.");
  const diffs = labs.map((lab) => deltaE(pixels.meanLab, lab));
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const closest = Math.min(...diffs);
  const of = neighbours.source === "library" ? "your other thumbnails" : "stand-in thumbnails";
  return check(
    "feed.distinct",
    "info",
    round(mean, 1),
    mean < LIMITS.blendsIn
      ? `Blends in: average colour difference ${round(mean, 1)} from ${of} (closest ${round(closest, 1)}). Change the dominant colour or brightness.`
      : `Stands out: average colour difference ${round(mean, 1)} from ${of} (closest ${round(closest, 1)}).`,
  );
}

/**
 * `measure` is render.cjs's `measure` ({canvas, blocks, images, pixels}); `neighbours` is
 * {labs: [Lab], source: "library"|"decoys"}. Returns the checks in the fixed order of the plan.
 */
export function computeChecks({ format, title, measure, neighbours }) {
  const fmt = LIMITS.maxWords[format] ? format : "video";
  const { canvas, images, pixels } = measure;
  const blocks = measure.blocks.map((b) => ({ ...b, canvasWidth: canvas.w }));
  const titleWords = new Set(tokenize(title).filter((w) => !STOPWORDS.has(w)));
  const text = textChecks(fmt, titleWords, blocks);
  return [...text, ...layoutChecks(fmt, blocks, images, canvas.w, canvas.h), subjectCheck(fmt, images, canvas.h), ...pixelChecks(pixels), distinctCheck(pixels, neighbours)];
}
