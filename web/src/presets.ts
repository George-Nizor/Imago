import type { ImagoIconName } from "./brand/imago-icons.js";
import type { PresetId, PresetInfo, Size } from "./api/types.js";

export interface PresetUi {
  id: PresetId;
  label: string;
  icon: ImagoIconName;
  blurb: string;
  chips: string[];
}

// Shown even if /api/presets is down; the server's wording and chips win when it answers.
export const PRESET_UI: PresetUi[] = [
  {
    id: "thumbnail",
    label: "YouTube thumbnail",
    icon: "thumbnail",
    blurb: "A bold 16:9 thumbnail with your face, a title and your colours.",
    chips: ["Make the title bigger", "Brighter background", "Try a different layout", "Fewer words"],
  },
  {
    id: "photo",
    label: "Edit a photo",
    icon: "photo",
    blurb: "Retouch, crop, recolour or restyle a photo you already have.",
    chips: ["Warmer tones", "More contrast", "Remove the background", "Make it black and white"],
  },
  {
    id: "graphic",
    label: "Custom graphic",
    icon: "graphic",
    blurb: "Posters, social posts, banners: describe it and pick a size.",
    chips: ["Bigger headline", "Try other colours", "More whitespace", "Simplify"],
  },
];
export const presetUi = (id: PresetId) => PRESET_UI.find((p) => p.id === id)!;

/** Fallbacks for when /api/presets is unreachable; the server's own lists win once it answers. */
export interface GraphicSize {
  id: string;
  label: string;
  group: string;
  size: Size;
}
const gs = (group: string, id: string, label: string, width: number, height: number): GraphicSize => ({ id, label, group, size: { width, height } });
export const GRAPHIC_SIZES: GraphicSize[] = [
  gs("Instagram", "ig-square", "Post, square", 1080, 1080),
  gs("Instagram", "ig-portrait", "Post, portrait", 1080, 1350),
  gs("Instagram", "ig-story", "Story or Reel", 1080, 1920),
  gs("Facebook", "fb-post", "Post, square", 1080, 1080),
  gs("Facebook", "fb-link", "Link image", 1200, 630),
  gs("Facebook", "fb-cover", "Cover photo", 1640, 624),
  gs("Facebook", "fb-event", "Event cover", 1920, 1005),
  gs("X / Twitter", "x-post", "Post image", 1600, 900),
  gs("X / Twitter", "x-header", "Header", 1500, 500),
  gs("LinkedIn", "li-square", "Post, square", 1200, 1200),
  gs("LinkedIn", "li-post", "Post, landscape", 1200, 627),
  gs("LinkedIn", "li-banner", "Profile banner", 1584, 396),
  gs("YouTube", "yt-banner", "Channel banner", 2560, 1440),
  gs("YouTube", "yt-thumb", "Thumbnail", 1280, 720),
  gs("TikTok", "tiktok", "Video cover", 1080, 1920),
  gs("Pinterest", "pin", "Pin", 1000, 1500),
  gs("Twitch", "twitch-banner", "Profile banner", 1200, 480),
  gs("Twitch", "twitch-offline", "Offline screen", 1920, 1080),
  gs("Discord", "discord-banner", "Server banner", 960, 540),
  gs("Web", "og", "Open Graph image", 1200, 630),
  gs("Web", "hero", "Hero", 1920, 1080),
  gs("Web", "blog", "Blog header", 1600, 900),
  gs("Web", "email", "Email header", 1200, 600),
  gs("Print (150 dpi)", "a4", "A4", 1240, 1754),
  gs("Print (150 dpi)", "a5", "A5", 874, 1240),
  gs("Print (150 dpi)", "letter", "US Letter", 1275, 1650),
  gs("Print (150 dpi)", "poster", "Poster 18×24 in", 2700, 3600),
  gs("Screens", "wallpaper", "Desktop wallpaper", 1920, 1080),
  gs("Screens", "phone", "Phone wallpaper", 1170, 2532),
  gs("Screens", "slide", "Presentation slide", 1920, 1080),
  gs("Audio", "podcast-cover", "Podcast cover", 3000, 3000),
  gs("Brand", "avatar", "Avatar or logo", 1000, 1000),
];
export const ASPECT_LABELS: Record<string, string> = {
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
export const ASPECTS: string[] = Object.keys(ASPECT_LABELS);

export interface ThumbnailFormat {
  id: string;
  label: string;
  hint: string;
  size: Size;
}
export const THUMBNAIL_FORMATS: ThumbnailFormat[] = [
  { id: "video", label: "Video 16:9", hint: "3840×2160", size: { width: 1280, height: 720 } },
  { id: "shorts", label: "Shorts 9:16", hint: "2160×3840", size: { width: 720, height: 1280 } },
  { id: "podcast", label: "Podcast 1:1", hint: "3840×3840", size: { width: 1280, height: 1280 } },
];

/** Graphic sizes with fixed pixels, from the server's preset when it has them. */
export function graphicSizes(preset: PresetInfo | undefined): GraphicSize[] {
  const list = (preset?.sizes ?? []).flatMap((s) =>
    typeof s.width === "number" && typeof s.height === "number" ? [{ id: s.id, label: s.label, group: s.group ?? "Sizes", size: { width: s.width, height: s.height } }] : [],
  );
  return list.length ? list : GRAPHIC_SIZES;
}

/** Photo aspect ids from the server's preset, else the fallback. */
export function photoAspects(preset: PresetInfo | undefined): { id: string; label: string }[] {
  const ids = preset?.sizes.length ? preset.sizes.map((s) => s.id) : ASPECTS;
  return ids.map((id) => ({ id, label: ASPECT_LABELS[id] ?? id }));
}

export const EXPORT_FORMATS = ["png", "jpg", "webp"] as const;
export const EXPORT_SCALES = [1, 1.5, 2, 3] as const;
/** The longest edge an export may have; beyond it Electron's capture loses content. */
export const MAX_EXPORT_EDGE = 8192;
export const allowedScales = (size: Size): number[] => EXPORT_SCALES.filter((s) => Math.round(Math.max(size.width, size.height) * s) <= MAX_EXPORT_EDGE);
/** YouTube's mobile upload limit; desktop allows 50 MB. */
export const YOUTUBE_MOBILE_MAX_BYTES = 2 * 1024 * 1024;
