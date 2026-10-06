import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const text = (name) => readFileSync(path.join(here, name), "utf8").trim();

export const PHOTO_ASPECTS = ["original", "1:1", "4:5", "3:4", "2:3", "9:16", "4:3", "3:2", "16:9", "21:9"];
export const PHOTO_ASPECT_LABELS = {
  original: "Keep original",
  "1:1": "1:1 Square",
  "4:5": "4:5 Instagram portrait",
  "3:4": "3:4 Portrait",
  "2:3": "2:3 Portrait photo",
  "9:16": "9:16 Story",
  "4:3": "4:3 Classic",
  "3:2": "3:2 Photo",
  "16:9": "16:9 Widescreen",
  "21:9": "21:9 Cinematic",
};

export const MIN_SIDE = 64;
export const MAX_SIDE = 4096;
/** The longest edge an export may have. Electron's offscreen capture is checked up to here. */
export const MAX_EXPORT_EDGE = 8192;
export const EXPORT_SCALES = [1, 1.5, 2, 3];
/** Export scales whose longest output edge stays within MAX_EXPORT_EDGE. */
export const allowedScales = (size) => EXPORT_SCALES.filter((s) => Math.round(Math.max(size.width, size.height) * s) <= MAX_EXPORT_EDGE);

// YouTube custom thumbnails: 3840x2160 (videos), 2160x3840 (Shorts), 1:1 (podcasts). The design
// canvas stays at 1280x720 / 720x1280 / 1280x1280 and 3x export gives the full resolution.
export const THUMBNAIL_FORMATS = [
  { id: "video", label: "Video 16:9", group: "YouTube", width: 1280, height: 720 },
  { id: "shorts", label: "Shorts 9:16", group: "YouTube", width: 720, height: 1280 },
  { id: "podcast", label: "Podcast 1:1", group: "YouTube", width: 1280, height: 1280 },
];
export const THUMBNAIL_NOTES = {
  video: "Format: video thumbnail, 16:9 (1280×720 canvas, exported at 3× as 3840×2160).",
  shorts: "Format: Shorts thumbnail, 9:16 vertical (720×1280 canvas, exported at 3× as 2160×3840).",
  podcast: "Format: podcast thumbnail, 1:1 square (1280×1280 canvas, exported at 3× as 3840×3840).",
};
export const thumbnailFormat = (id) => THUMBNAIL_FORMATS.find((f) => f.id === id);

// Current official or recommended pixel sizes. Print sizes are at 150 dpi. Facebook's cover is its
// 820x312 desktop display size at 2x; the link image is 1200x630.
const g = (group, id, label, width, height) => ({ id, label, group, width, height });
export const GRAPHIC_SIZES = [
  g("Instagram", "ig-square", "Post, square", 1080, 1080),
  g("Instagram", "ig-portrait", "Post, portrait", 1080, 1350),
  g("Instagram", "ig-story", "Story or Reel", 1080, 1920),
  g("Facebook", "fb-post", "Post, square", 1080, 1080),
  g("Facebook", "fb-link", "Link image", 1200, 630),
  g("Facebook", "fb-cover", "Cover photo", 1640, 624),
  g("Facebook", "fb-event", "Event cover", 1920, 1005),
  g("X / Twitter", "x-post", "Post image", 1600, 900),
  g("X / Twitter", "x-header", "Header", 1500, 500),
  g("LinkedIn", "li-square", "Post, square", 1200, 1200),
  g("LinkedIn", "li-post", "Post, landscape", 1200, 627),
  g("LinkedIn", "li-banner", "Profile banner", 1584, 396),
  g("YouTube", "yt-banner", "Channel banner", 2560, 1440),
  g("YouTube", "yt-thumb", "Thumbnail", 1280, 720),
  g("TikTok", "tiktok", "Video cover", 1080, 1920),
  g("Pinterest", "pin", "Pin", 1000, 1500),
  g("Twitch", "twitch-banner", "Profile banner", 1200, 480),
  g("Twitch", "twitch-offline", "Offline screen", 1920, 1080),
  g("Discord", "discord-banner", "Server banner", 960, 540),
  g("Web", "og", "Open Graph image", 1200, 630),
  g("Web", "hero", "Hero", 1920, 1080),
  g("Web", "blog", "Blog header", 1600, 900),
  g("Web", "email", "Email header", 1200, 600),
  g("Print (150 dpi)", "a4", "A4", 1240, 1754),
  g("Print (150 dpi)", "a5", "A5", 874, 1240),
  g("Print (150 dpi)", "letter", "US Letter", 1275, 1650),
  g("Print (150 dpi)", "poster", "Poster 18×24 in", 2700, 3600),
  g("Screens", "wallpaper", "Desktop wallpaper", 1920, 1080),
  g("Screens", "phone", "Phone wallpaper", 1170, 2532),
  g("Screens", "slide", "Presentation slide", 1920, 1080),
  g("Audio", "podcast-cover", "Podcast cover", 3000, 3000),
  g("Brand", "avatar", "Avatar or logo", 1000, 1000),
];

export const PRESETS = [
  {
    id: "thumbnail",
    label: "YouTube thumbnail",
    description: "A YouTube thumbnail (video 16:9, Shorts 9:16 or podcast 1:1) built to be read at a glance.",
    defaultSize: { width: 1280, height: 720 },
    sizes: THUMBNAIL_FORMATS,
    briefFields: [
      { id: "title", label: "Video title or topic", required: true, multiline: false },
      { id: "channelColours", label: "Channel colours", required: false, multiline: false },
      { id: "notes", label: "Notes", required: false, multiline: true },
      { id: "format", label: "Format", required: false, multiline: false }, // last: the title fallback uses the first field
    ],
    chips: ["Bigger text", "More contrast", "Swap sides", "Another direction"],
  },
  {
    id: "photo",
    label: "Edit a photo",
    description: "Upload a photo and say what to change: grade, crop, background, text.",
    defaultSize: null,
    sizes: PHOTO_ASPECTS.map((id) => ({ id, label: PHOTO_ASPECT_LABELS[id] })),
    briefFields: [{ id: "instruction", label: "What should change?", required: true, multiline: true }],
    chips: ["Warmer", "Cooler", "Tighter crop", "Remove background"],
  },
  {
    id: "graphic",
    label: "Custom graphic",
    description: "A poster, post, banner or cover from a description.",
    defaultSize: { width: 1080, height: 1080 },
    sizes: [...GRAPHIC_SIZES, { id: "custom", label: `Custom (${MIN_SIDE}–${MAX_SIDE} px)`, group: "Custom", width: null, height: null }],
    briefFields: [{ id: "description", label: "What should it show?", required: true, multiline: true }],
    chips: ["Simplify", "Bolder", "Different palette"],
  },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id);

/** Size for a photo of `source` dims in the chosen aspect, long edge at most 2160. */
export function photoSize(source, aspect = "original") {
  const cap = 2160;
  if (aspect === "original" || !/^\d+:\d+$/.test(aspect)) {
    const k = Math.min(1, cap / Math.max(source.width, source.height));
    return { width: Math.max(1, Math.round(source.width * k)), height: Math.max(1, Math.round(source.height * k)) };
  }
  // The largest a:b crop that fits inside the photo, so a crop never upscales the source.
  const [a, b] = aspect.split(":").map(Number);
  let width = Math.min(source.width, (source.height * a) / b);
  let height = (width * b) / a;
  const k = Math.min(1, cap / Math.max(width, height));
  width *= k;
  height *= k;
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

let rules;
const presetText = new Map();

/** Appended to Claude's system prompt every turn: shared rules, the preset, size and assets. */
export function buildSystemPrompt(project, fontFamilies = []) {
  rules ??= text("design-rules.md");
  if (!presetText.has(project.preset)) presetText.set(project.preset, text(`${project.preset}.md`));
  const assets = project.assets.length
    ? project.assets.map((a) => `- assets/${a.name} (${a.width}×${a.height}${a.kind === "cutout" ? ", cut-out with transparency" : ""})`).join("\n")
    : "(none uploaded)";
  return [
    rules,
    presetText.get(project.preset),
    `## This project\n\nCanvas: ${project.size.width}×${project.size.height} CSS pixels. Body must be exactly that size.${project.preset === "thumbnail" ? `\n${THUMBNAIL_NOTES[project.brief?.format] ?? THUMBNAIL_NOTES.video}` : ""}\nContent fonts: ${fontFamilies.join(", ")}.\n\n## Assets\n\n${assets}`,
  ].join("\n\n");
}

/** The first turn's prompt: the brief, then what the user typed. */
export function buildFirstPrompt(project, userText) {
  const preset = presetById(project.preset);
  const lines = [];
  for (const field of preset?.briefFields ?? []) {
    if (field.id === "format") continue; // told through the system prompt's canvas line
    const value = String(project.brief?.[field.id] ?? "").trim();
    if (value) lines.push(`${field.label}: ${value}`);
  }
  if (project.preset === "photo" && project.brief?.aspect && project.brief.aspect !== "original") lines.push(`Aspect ratio: ${project.brief.aspect}`);
  const brief = lines.length ? `Brief:\n${lines.join("\n")}\n\n` : "";
  return `${brief}${userText}`.trim();
}
