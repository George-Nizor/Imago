// Imago's interface icons in the Instrumenta v2 style (brand/ALIGNMENT.md): a flat drawing on a
// 48-unit grid, an ink outline and a stepped extrusion down and to the right.
//
// Adapted from Discere's icon set (Discere apps/web/src/brand/discere-icons.ts), which itself
// follows the brand library's renderer (Instrumenta brand/icons/instrumenta-icons.js). The renderer
// is unchanged apart from names; the glyph table is Imago's, with a few Discere glyphs reused
// (sparkle = xp, settings, done, refresh = swap). Output is presentation attributes only, so it is
// safe under a strict Content-Security-Policy.
/* eslint-disable */
  function oklchToHex(L: number, C: number, h: number): string {
    const a = C * Math.cos((h * Math.PI) / 180);
    const b = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return (
      "#" +
      lin
        .map((x: number) => {
          const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055;
          return Math.round(Math.min(1, Math.max(0, v)) * 255)
            .toString(16)
            .padStart(2, "0");
        })
        .join("")
        .toUpperCase()
    );
  }
  // Same formula as the suite: L 0.70, C 0.155 for the accent; tint, deep and ink derived.
  function colours(hue: number, chroma = 0.155) {
    return {
      accent: oklchToHex(0.7, chroma, hue),
      light: oklchToHex(0.86, Math.min(chroma, 0.09), hue),
      deep: oklchToHex(0.42, Math.min(chroma, 0.11), hue),
      ink: oklchToHex(0.2, 0.035, hue),
    };
  }
  // Secondary hues, for warnings (gold) and stopping (rose).
  // Imago teal is the product accent and uses the exact brand-token values; the rest are derived.
  const HUE: Record<string, number> = { teal: 195, gold: 85, ember: 45, rose: 5, ice: 230 };
  const IMAGO = { accent: "#00BCAB", light: "#89E5D9", deep: "#005F55", ink: "#001B18" };

  const G: Record<string, { hue: string; d: string }> = {
    // Presets
    thumbnail: { hue: "imago", d: '<rect class="f" x="5" y="10" width="38" height="28" rx="4"/><rect class="s" x="5" y="10" width="38" height="28" rx="4"/><path class="f2" d="M20 17.5 32 24 20 30.5Z"/><path class="s thin" d="M20 17.5 32 24 20 30.5Z"/><path class="s thin dt" d="M9 34H14M34 34H39"/>' },
    photo: { hue: "imago", d: '<rect class="f" x="6" y="8" width="36" height="32" rx="3"/><rect class="s" x="6" y="8" width="36" height="32" rx="3"/><path class="f2" d="M6 33 17 21 25 29 31 23 42 34V37A3 3 0 0 1 39 40H9A3 3 0 0 1 6 37Z"/><path class="s thin" d="M6 33 17 21 25 29 31 23 42 34"/><circle class="solid" cx="32" cy="16" r="3"/>' },
    graphic: { hue: "imago", d: '<circle class="f" cx="18" cy="18" r="11"/><circle class="s" cx="18" cy="18" r="11"/><rect class="f2" x="22" y="22" width="19" height="19" rx="2.5"/><rect class="s" x="22" y="22" width="19" height="19" rx="2.5"/><path class="f" d="M10 42 16.5 31 23 42Z"/><path class="s thin" d="M10 42 16.5 31 23 42Z"/>' },
    // Actions
    upload: { hue: "imago", d: '<path class="f" d="M24 6 36 19H29V30H19V19H12Z"/><path class="s" d="M24 6 36 19H29V30H19V19H12Z"/><path class="s" d="M8 31V39A2 2 0 0 0 10 41H38A2 2 0 0 0 40 39V31"/>' },
    export: { hue: "imago", d: '<path class="f" d="M19 6H29V18H36L24 31 12 18H19Z"/><path class="s" d="M19 6H29V18H36L24 31 12 18H19Z"/><path class="s" d="M8 33V39A2 2 0 0 0 10 41H38A2 2 0 0 0 40 39V33"/>' },
    send: { hue: "imago", d: '<path class="f" d="M6 9 42 24 6 39 12 24Z"/><path class="s" d="M6 9 42 24 6 39 12 24Z"/><path class="s thin" d="M12 24H27"/>' },
    stop: { hue: "rose", d: '<rect class="f" x="9" y="9" width="30" height="30" rx="6"/><rect class="s" x="9" y="9" width="30" height="30" rx="6"/><rect class="f2" x="18" y="18" width="12" height="12" rx="2"/>' },
    versions: { hue: "imago", d: '<circle class="f" cx="25" cy="25" r="17"/><circle class="s" cx="25" cy="25" r="17"/><path class="s" d="M25 14V25L32 29"/><path class="f2" d="M3 22 9 28 15 22Z"/><path class="s thin" d="M3 22 9 28 15 22Z"/>' },
    sparkle: { hue: "imago", d: '<path class="f m-twinkle" d="M24 4C26.5 16 32 21.5 44 24C32 26.5 26.5 32 24 44C21.5 32 16 26.5 4 24C16 21.5 21.5 16 24 4Z"/><path class="s m-twinkle" d="M24 4C26.5 16 32 21.5 44 24C32 26.5 26.5 32 24 44C21.5 32 16 26.5 4 24C16 21.5 21.5 16 24 4Z"/><path class="f2 flat dt" d="M38 6C38.6 9 39.8 10.4 42.5 11C39.8 11.6 38.6 13 38 16C37.4 13 36.2 11.6 33.5 11C36.2 10.4 37.4 9 38 6Z"/>' },
    cutout: { hue: "imago", d: '<path class="s" d="M15 31 33 6M33 31 15 6"/><circle class="f2" cx="13" cy="37" r="5.5"/><circle class="s" cx="13" cy="37" r="5.5"/><circle class="f2" cx="35" cy="37" r="5.5"/><circle class="s" cx="35" cy="37" r="5.5"/>' },
    copy: { hue: "imago", d: '<rect class="f2" x="8" y="6" width="22" height="28" rx="3"/><rect class="s" x="8" y="6" width="22" height="28" rx="3"/><rect class="f" x="18" y="14" width="22" height="28" rx="3"/><rect class="s" x="18" y="14" width="22" height="28" rx="3"/><path class="s thin" d="M24 24H34M24 30H34"/>' },
    close: { hue: "rose", d: '<path class="s" d="M12 12 36 36M36 12 12 36"/>' },
    moon: { hue: "imago", d: '<path class="f" d="M30 6A18 18 0 1 0 42 31 14 14 0 0 1 30 6Z"/><path class="s" d="M30 6A18 18 0 1 0 42 31 14 14 0 0 1 30 6Z"/>' },
    sun: { hue: "gold", d: '<rect class="f" x="22.5" y="3" width="3" height="7" rx="1.5" transform="rotate(0 24 24)"/><rect class="f" x="22.5" y="3" width="3" height="7" rx="1.5" transform="rotate(45 24 24)"/><rect class="f" x="22.5" y="3" width="3" height="7" rx="1.5" transform="rotate(90 24 24)"/><rect class="f" x="22.5" y="3" width="3" height="7" rx="1.5" transform="rotate(135 24 24)"/><rect class="f" x="22.5" y="3" width="3" height="7" rx="1.5" transform="rotate(180 24 24)"/><rect class="f" x="22.5" y="3" width="3" height="7" rx="1.5" transform="rotate(225 24 24)"/><rect class="f" x="22.5" y="3" width="3" height="7" rx="1.5" transform="rotate(270 24 24)"/><rect class="f" x="22.5" y="3" width="3" height="7" rx="1.5" transform="rotate(315 24 24)"/><circle class="f2" cx="24" cy="24" r="10"/><circle class="s" cx="24" cy="24" r="10"/>' },
    alert: { hue: "gold", d: '<path class="f" d="M24 6 43 39H5Z"/><path class="s" d="M24 6 43 39H5Z"/><path class="s" d="M24 17V27"/><circle class="solid" cx="24" cy="32.5" r="1.8"/>' },
    // Reused from Discere
    done: { hue: "imago", d: '<circle class="f" cx="24" cy="24" r="18"/><circle class="s" cx="24" cy="24" r="18"/><path class="s m-tick" d="M15.5 24.5 21.5 30.5 33 18"/>' },
    refresh: { hue: "imago", d: '<path class="f" d="M8 18A16 16 0 0 1 36 12L38 8 42 20 30 20 33 16A11 11 0 0 0 13 19Z"/><path class="s" d="M8 18A16 16 0 0 1 36 12L38 8 42 20 30 20 33 16A11 11 0 0 0 13 19Z"/><path class="f2" d="M40 30A16 16 0 0 1 12 36L10 40 6 28 18 28 15 32A11 11 0 0 0 35 29Z"/><path class="s" d="M40 30A16 16 0 0 1 12 36L10 40 6 28 18 28 15 32A11 11 0 0 0 35 29Z"/>' },
    settings: { hue: "imago", d: '<path class="f" d="M21 5H27L28 10.5 32.5 12.5 37 9.3 41.2 13.5 38 18 40 22.5 45.5 23.5V29.5L40 30.5 38 35 41.2 39.5 37 43.7 32.5 40.5 28 42.5 27 48H21L20 42.5 15.5 40.5 11 43.7 6.8 39.5 10 35 8 30.5 2.5 29.5V23.5L8 22.5 10 18 6.8 13.5 11 9.3 15.5 12.5 20 10.5Z" transform="translate(24 26.5) scale(.82) translate(-24 -26.5)"/><path class="s" d="M21 5H27L28 10.5 32.5 12.5 37 9.3 41.2 13.5 38 18 40 22.5 45.5 23.5V29.5L40 30.5 38 35 41.2 39.5 37 43.7 32.5 40.5 28 42.5 27 48H21L20 42.5 15.5 40.5 11 43.7 6.8 39.5 10 35 8 30.5 2.5 29.5V23.5L8 22.5 10 18 6.8 13.5 11 9.3 15.5 12.5 20 10.5Z" transform="translate(24 26.5) scale(.82) translate(-24 -26.5)"/><circle class="f2" cx="24" cy="26.5" r="6"/><circle class="s" cx="24" cy="26.5" r="6"/>' },
  };

  const TIERS: Record<string, { steps: number; dx: number; dy: number; line: number; thin: number; depthLine: number; details: boolean }> = {
    full: { steps: 6, dx: 0.5, dy: 0.55, line: 2.3, thin: 1.7, depthLine: 3.2, details: true },
    medium: { steps: 3, dx: 0.85, dy: 0.95, line: 2.8, thin: 2.1, depthLine: 3.4, details: false },
    small: { steps: 2, dx: 1.1, dy: 1.25, line: 3.4, thin: 2.6, depthLine: 3.6, details: false },
  };
  const tierFor = (size?: number) => (size && size <= 16 ? "small" : size && size <= 24 ? "medium" : "full");
  const TAG = /<(\/?)(g|rect|path|circle|ellipse)\b([^>]*?)(\/?)>/g;
  function paint(markup: string, look: (tag: string, tokens: string[]) => string | null): string {
    return markup.replace(TAG, (whole: string, closing: string, tag: string, attrs: string, selfClose: string) => {
      if (closing) return whole;
      const m = attrs.match(/\sclass="([^"]*)"/);
      const tokens = m?.[1] ? m[1].split(/\s+/) : [];
      const rest = attrs.replace(/\sclass="[^"]*"/, "");
      const motion = tokens.filter((t) => /^(m-|w\d)/.test(t));
      const extra = look(tag, tokens);
      if (extra === null) return "";
      const cls = motion.length ? ` class="${motion.join(" ")}"` : "";
      return `<${tag}${cls}${rest}${extra}${selfClose ? "/" : ""}>`;
    });
  }
  const dropDetails = (s: string) => s.replace(/<(rect|path|circle|ellipse)\b[^>]*\bclass="[^"]*\bdt\b[^"]*"[^>]*\/>/g, "");

  function render(id: string, options: { size?: number; hue?: string; label?: string; tier?: string } = {}): string {
    const glyph = G[id];
    if (!glyph) throw new Error(`Unknown Imago icon: ${id}`);
    const tier = TIERS[options.tier || tierFor(options.size)]!;
    const hue = options.hue || glyph.hue;
    const col = hue === "imago" ? IMAGO : colours(HUE[hue]!);
    let d = glyph.d;
    if (!tier.details) d = dropDetails(d);
    const round = ' stroke-linecap="round" stroke-linejoin="round"';
    const front = paint(d, (tag: string, t: string[]) => {
      if (tag === "g") return "";
      if (t.includes("f")) return ` fill="${col.accent}"`;
      if (t.includes("f2")) return ` fill="${col.light}"`;
      if (t.includes("solid")) return ` fill="${col.ink}"`;
      if (t.includes("s")) return ` fill="none" stroke="${col.ink}" stroke-width="${t.includes("thin") ? tier.thin : tier.line}"${round}`;
      return "";
    });
    const depthLayer = paint(d, (tag: string, t: string[]) => {
      if (tag === "g") return "";
      if (t.includes("flat")) return null;
      return ` fill="${col.deep}" stroke="${col.deep}" stroke-width="${tier.depthLine}" stroke-linejoin="round"`;
    });
    const depth = [...Array(tier.steps)]
      .map((_: unknown, i: number) => {
        const n = tier.steps - i;
        return `<g transform="translate(${(n * tier.dx).toFixed(2)} ${(n * tier.dy).toFixed(2)})">${depthLayer}</g>`;
      })
      .join("");
    const shift = `translate(${(-tier.steps * tier.dx * 0.5).toFixed(2)} ${(-tier.steps * tier.dy * 0.5).toFixed(2)})`;
    const size = options.size ? ` width="${options.size}" height="${options.size}"` : "";
    const label = options.label ? ` role="img" aria-label="${options.label}"` : ' aria-hidden="true"';
    return `<svg viewBox="-2 -2 52 52"${size} class="ii ii-${id}"${label}><g transform="${shift}"><g class="ii-body"><g>${depth}</g><g>${front}</g></g></g></svg>`;
  }

export type ImagoIconName = keyof typeof G;
export type ImagoIconHue = "imago" | keyof typeof HUE;
export interface IconOptions {
  size?: number;
  hue?: ImagoIconHue;
  label?: string;
  tier?: "full" | "medium" | "small";
}
export const renderImagoIcon = render as (id: ImagoIconName, options?: IconOptions) => string;
export const imagoIconNames = Object.keys(G) as ImagoIconName[];
