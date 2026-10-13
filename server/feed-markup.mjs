// Markup for the feed mock-up: one function per place a thumbnail appears. Pure strings with every
// text escaped, no Node imports, so the render MCP (which stages it as a static page for the sandboxed
// renderer) and the browser UI (which injects it) draw exactly the same thing. Styles: feed.css.
//
// Sizes and zones are in docs/redesign-contract.md ("Feed mock-up"), with where each came from.

export const FORMATS = ["video", "shorts", "podcast"];

/** Surfaces per format, in the order the mock-up shows them. `width` is the natural CSS width. */
export const SURFACES = {
  video: [
    { id: "home", label: "Home grid, desktop", width: 736, count: 2, at: 1 },
    { id: "search", label: "Search results, desktop", width: 736, count: 2, at: 1 },
    { id: "sidebar", label: "Watch page sidebar, 168 px", width: 360, count: 5, at: 1, row: "a" },
    { id: "mobile", label: "Mobile home, full width", width: 360, count: 2, at: 1, row: "a" },
  ],
  shorts: [
    { id: "shelf", label: "Shorts shelf", width: 736, count: 4, at: 1 },
    { id: "shorts", label: "YouTube Shorts, full screen", width: 390, count: 1, at: 0 },
    { id: "reels", label: "Instagram Reels, full screen", width: 390, count: 1, at: 0 },
    { id: "tiktok", label: "TikTok, full screen", width: 390, count: 1, at: 0 },
    { id: "igGrid", label: "Instagram profile grid (3:4 crop)", width: 364, count: 6, at: 1, row: "g" },
    { id: "ttGrid", label: "TikTok profile grid (3:4 crop)", width: 364, count: 6, at: 1, row: "g" },
  ],
  podcast: [
    { id: "playlist", label: "Podcast shelf, square cards", width: 736, count: 4, at: 1 },
    { id: "list", label: "Mobile podcast list", width: 360, count: 4, at: 1 },
    { id: "episode", label: "Square in a 16:9 slot (pillarboxed)", width: 736, count: 2, at: 0 },
  ],
};

export const DECOYS = [
  { title: "I tried it for 30 days, here is what happened", channel: "Northline", views: "1.2M views", age: "3 weeks ago", duration: "14:08" },
  { title: "The one mistake almost everyone makes", channel: "Daily Craft", views: "384K views", age: "5 days ago", duration: "8:41" },
  { title: "Behind the scenes of the biggest build yet", channel: "Maker Hour", views: "92K views", age: "1 day ago", duration: "21:15" },
  { title: "Why this changed everything for us", channel: "Field Notes", views: "2.8M views", age: "2 months ago", duration: "11:02" },
  { title: "Testing the cheapest option so you do not have to", channel: "Spare Parts", views: "57K views", age: "6 days ago", duration: "9:27" },
  { title: "We were wrong about this the whole time", channel: "The Long Way", views: "640K views", age: "4 days ago", duration: "17:50" },
];

const PALETTES = [
  ["#3b5b8c", "#d9a441", "#e8e2d6"],
  ["#7a3b3b", "#2a2a2a", "#e0c3a0"],
  ["#2f6f5e", "#a8d5c2", "#f2f2f2"],
  ["#555555", "#999999", "#dddddd"],
  ["#463a6b", "#c76d8f", "#f0d9e0"],
  ["#b5651d", "#2a2a2a", "#f4e3c1"],
];

/** A neutral stand-in thumbnail: a gradient and a disc as an SVG data URI, plus its approximate mean sRGB. */
export function decoyImage(n, format) {
  const [w, h] = format === "shorts" ? [720, 1280] : format === "podcast" ? [1000, 1000] : [1280, 720];
  const [c1, c2, c3] = PALETTES[n % PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.66}" cy="${h * 0.52}" r="${Math.min(w, h) * 0.22}" fill="${c3}"/></svg>`;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b, c] = [rgb(c1), rgb(c2), rgb(c3)];
  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, meanRgb: [0, 1, 2].map((i) => 0.85 * ((a[i] + b[i]) / 2) + 0.15 * c[i]) };
}

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICONS = {
  like: "M2 10h4v11H2zM8 21V10l4-7c2 0 3 1 2.5 3L14 10h6c1.5 0 2.3 1.2 2 2.5l-1.5 7c-.3 1.2-1.3 1.5-2 1.5H8z",
  heart: "M12 21s-7-4.5-9.5-9C.8 8.5 3 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3C21 5 23.2 8.5 21.5 12 19 16.5 12 21 12 21z",
  comment: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 0-1z",
  share: "M14 4l7 7-7 7v-4c-6 0-9 2-11 5 1-6 4-10 11-11V4z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  music: "M16 3v11.5a3.5 3.5 0 1 1-2-3.2V6l-6 1.5V17a3.5 3.5 0 1 1-2-3.2V5z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  search: "M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z",
  more: "M12 5.5a1.7 1.7 0 1 1 0 .01zM12 10.3a1.7 1.7 0 1 1 0 .01zM12 15.1a1.7 1.7 0 1 1 0 .01z",
  home: "M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z",
};
const icon = (name, flip = false) =>
  `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"${flip ? ' style="transform:rotate(180deg)"' : ""}><path fill="currentColor" d="${ICONS[name]}"/></svg>`;

/** `count` items with `mine` at `at`; the rest come from `neighbours`, wrapping, each at most once per surface where it can. */
export function place(neighbours, mine, count, at) {
  const out = [];
  const pool = neighbours.length ? neighbours : [mine];
  let k = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === at) out.push({ ...mine, mine: true });
    else out.push({ ...pool[k++ % pool.length], mine: false });
  }
  return out;
}

const img = (item) => `<img src="${esc(item.src)}" alt="">`;
const badge = (item) => (item.duration ? `<span class="fd-dur">${esc(item.duration)}</span>` : "");
const mark = (item) => (item.mine ? " fd-mine" : "");
const avatar = (item, size = "") => `<span class="fd-av ${size}" aria-hidden="true">${esc([...String(item.channel || "?")][0]?.toUpperCase() ?? "?")}</span>`;
const sub = (item) => [item.views, item.age].filter(Boolean).map(esc).join(" · ");

const card = (item, cls) => `<div class="${cls}"><div class="fd-thumb${mark(item)}">${img(item)}${badge(item)}</div><div class="fd-meta">${avatar(item)}<div class="fd-text"><div class="fd-title">${esc(item.title)}</div><div class="fd-sub">${esc(item.channel)}</div><div class="fd-sub">${sub(item)}</div></div></div></div>`;

const phone = (item, name, body) =>
  `<div class="fd-phone fd-${name}"><div class="fd-bg${mark(item)}">${img(item)}</div><div class="fd-scrim-top"></div><div class="fd-scrim-bottom"></div>${body}<div class="fd-nav">${[0, 1, 2, 3, 4].map(() => '<i></i>').join("")}</div></div>`;

const rail = (items) => `<div class="fd-rail">${items.map(([name, label, flip]) => `<div>${icon(name, Boolean(flip))}<span>${esc(label)}</span></div>`).join("")}</div>`;

const BUILDERS = {
  home: (items) => `<div class="fd-home">${items.map((i) => card(i, "fd-card")).join("")}</div>`,
  search: (items) =>
    `<div class="fd-searchlist">${items.map((i) => `<div class="fd-result"><div class="fd-thumb${mark(i)}">${img(i)}${badge(i)}</div><div class="fd-text"><div class="fd-title">${esc(i.title)}</div><div class="fd-sub">${sub(i)}</div><div class="fd-sub fd-chan">${avatar(i, "sm")}${esc(i.channel)}</div><div class="fd-sub fd-snippet">New video. Watch the full story, with chapters, links and everything we used.</div></div></div>`).join("")}</div>`,
  sidebar: (items) =>
    `<div class="fd-sidebar">${items.map((i) => `<div class="fd-side"><div class="fd-thumb${mark(i)}">${img(i)}${badge(i)}</div><div class="fd-text"><div class="fd-title">${esc(i.title)}</div><div class="fd-sub">${esc(i.channel)}</div><div class="fd-sub">${sub(i)}</div></div></div>`).join("")}</div>`,
  mobile: (items) => `<div class="fd-mobile">${items.map((i) => card(i, "fd-mcard")).join("")}</div>`,
  shelf: (items) =>
    `<div class="fd-shelf">${items.map((i) => `<div class="fd-tile"><div class="fd-thumb${mark(i)}">${img(i)}</div><div class="fd-title">${esc(i.title)}</div><div class="fd-sub">${esc(i.views)}</div></div>`).join("")}</div>`,
  shorts: ([i]) =>
    phone(i, "shorts", `<div class="fd-topbar">${icon("search")}${icon("more")}</div>${rail([["like", "12K"], ["like", "Dislike", true], ["comment", "340"], ["share", "Share"], ["plus", "Remix"]])}<div class="fd-caption"><div class="fd-row">${avatar(i, "sm")}<b>@${esc(i.channel.replace(/\s+/g, "").toLowerCase())}</b><span class="fd-pill">Subscribe</span></div><div class="fd-ctitle">${esc(i.title)}</div></div>`),
  reels: ([i]) =>
    phone(i, "reels", `<div class="fd-topbar"><b>Reels</b>${icon("more")}</div>${rail([["heart", "12K"], ["comment", "340"], ["share", "1,2K"], ["more", ""]])}<div class="fd-caption"><div class="fd-row">${avatar(i, "sm")}<b>${esc(i.channel.replace(/\s+/g, "_").toLowerCase())}</b><span class="fd-pill ghost">Follow</span></div><div class="fd-ctitle">${esc(i.title)}</div><div class="fd-row fd-audio">${icon("music")}<span>Original audio</span></div></div>`),
  tiktok: ([i]) =>
    phone(i, "tiktok", `<div class="fd-topbar mid"><span>Following</span><b>For You</b>${icon("search")}</div>${rail([["plus", ""], ["heart", "12.4K"], ["comment", "340"], ["bookmark", "1,203"], ["share", "88"]])}<div class="fd-caption"><b>@${esc(i.channel.replace(/\s+/g, "").toLowerCase())}</b><div class="fd-ctitle">${esc(i.title)} <span class="fd-tag">#fyp</span></div><div class="fd-row fd-audio">${icon("music")}<span>original sound</span></div></div>`),
  igGrid: (items) => `<div class="fd-grid">${items.map((i) => `<div class="fd-gtile${mark(i)}">${img(i)}</div>`).join("")}</div>`,
  ttGrid: (items) =>
    `<div class="fd-grid">${items.map((i, n) => `<div class="fd-gtile${mark(i)}">${img(i)}<span class="fd-views"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M6 4l14 8-14 8z"/></svg> ${esc(["48.2K", "1.2M", "9,841", "310K", "27.5K", "764K"][n % 6])}</span></div>`).join("")}</div>`,
  playlist: (items) =>
    `<div class="fd-shelf sq">${items.map((i) => `<div class="fd-tile"><div class="fd-thumb${mark(i)}">${img(i)}</div><div class="fd-title">${esc(i.title)}</div><div class="fd-sub">Podcast · ${esc(i.channel)}</div></div>`).join("")}</div>`,
  list: (items) =>
    `<div class="fd-podlist">${items.map((i) => `<div class="fd-row2"><div class="fd-thumb${mark(i)}">${img(i)}</div><div class="fd-text"><div class="fd-title">${esc(i.title)}</div><div class="fd-sub">${esc(i.channel)}</div><div class="fd-sub">${sub(i)}</div></div></div>`).join("")}</div>`,
  episode: (items) =>
    `<div class="fd-home">${items.map((i) => `<div class="fd-card"><div class="fd-thumb slot${mark(i)}">${img(i)}${badge(i)}</div><div class="fd-meta">${avatar(i)}<div class="fd-text"><div class="fd-title">${esc(i.title)}</div><div class="fd-sub">${esc(i.channel)}</div><div class="fd-sub">${sub(i)}</div></div></div></div>`).join("")}</div>`,
};

/** One surface as markup (no theme wrapper). `neighbours` need src, title, channel, views, age, duration. */
export function surfaceHtml(surface, mine, neighbours) {
  const def = Object.values(SURFACES).flat().find((s) => s.id === surface);
  const build = BUILDERS[surface];
  if (!def || !build) return "";
  return build(place(neighbours, mine, def.count, def.at));
}

/** A themed wrapper around some surfaces: `<div class="fd" data-theme>`. */
export const themed = (theme, inner) => `<div class="fd" data-theme="${theme === "light" ? "light" : "dark"}">${inner}</div>`;

/** The whole mock-up page body for one format: every surface, dark and light. */
export function feedBody(format, mine, neighbours) {
  const surfaces = SURFACES[format] ?? SURFACES.video;
  // Surfaces that share a `row` sit side by side.
  const rows = (list, theme) => {
    const out = [];
    for (const def of list) {
      const last = out.at(-1);
      if (def.row && last?.row === def.row) last.defs.push(def);
      else out.push({ row: def.row, defs: [def] });
    }
    return out.map((r) => (r.defs.length > 1 ? `<div class="fd-pairrow">${r.defs.map((d) => section(d, theme)).join("")}</div>` : section(r.defs[0], theme))).join("");
  };
  const section = (def, theme) => `<section class="fd-surface"><h3 class="fd-label">${esc(def.label)}</h3>${themed(theme, surfaceHtml(def.id, mine, neighbours))}</section>`;
  if (format === "shorts") {
    const phones = surfaces.filter((s) => ["shorts", "reels", "tiktok"].includes(s.id));
    const rest = surfaces.filter((s) => !phones.includes(s));
    const col = (theme) => `<div class="fd-col fd-col-${theme}">${rows(rest, theme)}</div>`;
    return `<div class="fd-page"><div class="fd-phones">${phones.map((s) => section(s, "dark")).join("")}</div><div class="fd-cols">${col("dark")}${col("light")}</div><p class="fd-key">Outlined: this design. Neighbours are other designs of yours, or stand-ins.</p></div>`;
  }
  const col = (theme) => `<div class="fd-col fd-col-${theme}">${rows(surfaces, theme)}</div>`;
  return `<div class="fd-page"><div class="fd-cols">${col("dark")}${col("light")}</div><p class="fd-key">Outlined: this design. Neighbours are other designs of yours, or stand-ins.</p></div>`;
}
