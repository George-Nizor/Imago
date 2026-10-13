# Imago rebuild contract

Imago is an AI designer that runs on the owner's own Claude Code subscription. Claude designs in
HTML, CSS and SVG, and Imago renders the result to an image. There are three presets: a YouTube
thumbnail, editing an existing photo, and a custom graphic.

This file is the contract between the server, the UI and the launcher. Change it only on purpose,
and in the same commit as the code that changes.

## Layout

```text
Imago/
├── package.json        one package; npm; "type": "module"
├── server/             Node ESM (.mjs), no build step, node:http only
│   ├── index.mjs       HTTP + SSE, serves web/dist, fonts/, project files
│   ├── store.mjs       project folders and project.json
│   ├── process.mjs     spawn with process-group kill, timeout, abort
│   ├── claude-runner.mjs   one turn = one `claude -p` run, stream-json parsed
│   ├── capabilities.mjs    claude and renderer readiness
│   ├── validate.mjs    design.html rules
│   ├── cutout.mjs      background removal (@imgly/background-removal-node)
│   ├── render-mcp.mjs  stdio MCP server handed to claude: tools `render` and `cut_out`
│   ├── checks.mjs      the render checks (pure functions over measurements)
│   ├── feed.mjs        stages the feed mock-up (neighbours, temp folder); feed-markup.mjs + feed.css draw it
│   ├── series.mjs      series.json (series metadata)
│   ├── library.mjs     list query (filter, sort, page) and the style-reference copy
│   ├── zip.mjs         a store-only zip writer for the library's Export
│   ├── kits.mjs        Fabula thumbnail kits: discovery, strict validation, import, contact sheet, the "From the video" prompt section
│   ├── concept-sets.mjs   concept sets: planner, parallel design turns, fallback, cancel, another concept
│   ├── faces.mjs       the face pack: uploads, cut-out queue, classification batches (face.json is written only here)
│   ├── face-retouch.mjs local retouching of a face cut-out (white balance, exposure, warmth, skin smoothing, redness, sharpen)
│   ├── face-pack.mjs   the pack's vocabulary, label validation, quality grade, ranking, use_face; read by the server and the render MCP
│   ├── brands.mjs      brands: validation, CRUD, assets, and the snapshot into a project or a concept set's planner folder (see Brands)
│   ├── face-sheet.mjs  numbered contact sheets of face images (classifier batch, planner pack sheet, find_faces)
│   ├── exports.mjs     Test & Compare and per-platform JPG exports under a size budget; the one-click export and the exports list
│   ├── face-sticker.mjs  baked sticker outlines for pack faces, and the 2400 px cap on every face a project receives
│   ├── project-faces.mjs  Refresh faces (no turn) and Try other faces (a face-variant set)
│   ├── render-version.mjs one render of design.html as a new version, shared by the render MCP and the server's own renders
│   └── presets/        design-rules.md, thumbnail.md, photo.md, graphic.md, series.md, further.md, planner.md, planner-titles.md, concept.md, face-swap.md, craft/<preset>/
├── render/render.cjs   headless Electron: design.html -> png|jpg|webp, plus measurements and the feed capture
│   (dom-measure.cjs runs inside the page; measure.cjs is the pixel maths)
├── fonts/              content fonts for designs (TTF) + fonts.css + fonts.json
├── web/                Vite + React + TS UI -> web/dist
└── tests/              node --test; never spends subscription usage
```

Scripts: `npm start` (server), `npm run dev` (server and Vite together, Vite proxying `/api`,
`/projects`, `/fonts` to the server), `npm run build` (UI), `npm test`.

## Runtime

- `PORT` comes from the environment (default `49321`). The server always binds `127.0.0.1`; there is
  no `HOST` setting. Never listen on anything but loopback.
- `IMAGO_WEB_ROOT` is the built UI, `web/dist` by default, resolved against the package root.
- `IMAGO_DATA_DIR` holds the projects (`projects/`), `series.json`, the concept sets (`concept-sets/`), the face pack (`faces/`), the brands (`brands/`) and the trash (`projects/.trash/`), `~/.local/share/imago` by default.
- `IMAGO_CLAUDE_BIN` is `claude` by default. Tests point it at `tests/fixtures/fake-claude.mjs`.
- `IMAGO_MODEL` defaults to `claude-sonnet-5-5`. `IMAGO_EFFORT` defaults to `medium`.
- `IMAGO_FACES_MODEL` defaults to `claude-haiku-5-5`: the model of the face pack's classification turn (always `--effort low`).
- `IMAGO_FURTHER_MODELS` defaults to `opus=claude-opus-5-5,fable=claude-fable-5-1`: the models a
  "Take it further" turn can use. `IMAGO_FURTHER_EFFORT` defaults to `high`.
- `IMAGO_TURN_TIMEOUT_MS` defaults to 600000.
- `IMAGO_FABULA_PROJECTS` is a comma-separated list of Fabula project roots searched for thumbnail kits. Default: `~/.local/share/fabula/projects`, plus the sibling checkout's `../Fabula/media` when it exists. Only `<root>/<project>/out/thumbnail-kit/` is ever read.
- `IMAGO_CONCEPT_CONCURRENCY` defaults to 3: how many concept design turns run at once, across all sets (1 to 8).
- `IMAGO_ALLOWED_ORIGINS` is empty by default: extra browser origins (comma separated) allowed to make
  changing requests. `npm run dev` sets the Vite origins (`http://127.0.0.1:5173`, `http://localhost:5173`).
- `IMAGO_ELECTRON_BIN` is the `electron` package binary by default.

## Project folder

`<IMAGO_DATA_DIR>/projects/<id>/`, where `<id>` matches `^[a-z0-9][a-z0-9-]{0,63}$` (a slug of
the title plus a short random suffix).

```text
project.json
design.html             current design; what the preview shows
assets/                 uploads, cutouts (safe leaf names only)
reference/              style-reference.html: the series reference design (see Library); kit.json (see Fabula kits); brand.json (see Brands); never served
reference/craft/        the preset's craft files, copied in by the server on every turn (see Thumbnail craft); never served
versions/v<n>.html      snapshot taken at each render
renders/v<n>.png        the render of that snapshot, at scale 1
renders/v<n>-feed.png   thumbnails only: that render in a feed mock-up (see "Feed mock-up and checks")
exports/                files made by Export (JPGs, and the zips of platform covers); listed in the UI with a download button (see "Exports")
```

`project.json`:

```json
{
  "schemaVersion": 1,
  "id": "rocket-thumb-3k9x",
  "title": "Rocket thumbnail",
  "preset": "thumbnail",
  "size": { "width": 1280, "height": 720 },
  "createdAt": "ISO", "updatedAt": "ISO",
  "sessionId": null,
  "briefSent": false,
  "brief": { "free-form fields from the start form": "" },
  "assets": [{ "name": "face.png", "kind": "upload|cutout|stock|reference|kit|face|brand", "width": 0, "height": 0, "from": null }],
  "messages": [{ "role": "user|assistant", "text": "", "at": "ISO", "version": null, "mode": "standard|further", "model": "claude-..." }],
  "versions": [{ "n": 1, "at": "ISO", "warnings": [], "checks": [{ "id": "text.words", "level": "ok", "value": 3, "message": "3 words." }] }],
  "current": 1,
  "running": false,
  "series": null,
  "starred": false,
  "conceptSet": { "id": "set-3k9x", "index": 0, "archetype": "reaction", "label": "Shocked first look" },
  "kit": { "id": "…", "title": "…", "project": "…", "createdAt": "ISO", "contactSheet": true },
  "brand": { "id": "instrumenta-1a2b", "name": "Instrumenta" }
}
```

An asset of kind `face` is a pack face copied in (`face-<id>.png`, `face-<id>-mirrored.png`, and with a baked outline `face-<id>[-mirrored]-sticker.png`; it also carries `faceId` and `mirrored`); `syncAssets` recognises those names. A copy made by `use_face` or by a concept set also carries `stamp {file, mtimeMs}` (which pack file it came from and that file's modification time: how the project knows its copy is out of date) and, for a sticker, `sticker {cream, ink, displayWidth, creamPx, inkPx}` and `display {width, height, offset}` (what Refresh faces bakes again). A `versions[]` entry the server made without a turn carries `note: "faces refreshed"`.

An asset of kind `brand` is a brand file copied in at creation (`brand-<name>`; it also carries `brandKind` logo|mascot|other and `note`). A kit face frame imported with face source `auto` carries `quality {grade, faceHeightPx, sharpness}`, the pack's own grade.

`brand` exists only on projects made with one (see "Brands"); `conceptSet` and `kit` exist only on projects made as one concept of a set, or from a Fabula kit (see "Fabula
kits" and "Concept sets"); `archetype` and `label` are null until the planner has run. A project without them is an
ordinary one.

`series` (a series id or null) and `starred` belong to the library; a `project.json` without them
counts as no series and not starred. A duplicate also carries `duplicatedFrom` (the source id).

`briefSent` is false until claude has started a session for the project (the `system/init` event
or a stored `sessionId`). The first-turn prompt (the brief plus the user's text) is sent on every
turn until then, so a first turn that dies before init does not lose the brief. A project without
the field counts as sent when it has a `sessionId`. `running` is written true before
`POST /messages` answers 202 and is always cleared when the turn ends, whatever happened.

The server is the only writer of `project.json`. The render MCP writes only `versions/`, `renders/`
and `assets/`.

## Presets

| id | Default size | Brief fields |
| --- | --- | --- |
| `thumbnail` | by `brief.format`: `video` 16:9 1280×720 (default), `shorts` 9:16 720×1280, `podcast` 1:1 1280×1280 | `title` (the video's title or topic), `channelColours?`, `notes?`, `format?`, `faceSource?` (see "Face source"); the brief may also carry `platforms?` (an array, kept only for `shorts`; see Thumbnail craft). `POST /api/projects` also takes `kit` (see Fabula kits) |
| `photo` | the first uploaded photo's own size, or an aspect chosen from `original, 1:1, 4:5, 3:4, 2:3, 9:16, 4:3, 3:2, 16:9, 21:9` (long edge kept at most 2160) | `instruction` |
| `graphic` | chosen from the grouped catalogue below, or custom (64–4096 each side) | `description` |

**Thumbnails.** YouTube's custom thumbnail spec: 3840×2160 for videos, 2160×3840 for Shorts, 1:1
for podcasts; JPG or PNG; 2 MB limit from the mobile app, 50 MB from desktop. The design canvas
stays at the sizes above (type and layout are tuned for them) and the full resolution comes from
export at 3×. `POST /api/projects` takes the size from `brief.format`; an unknown format is 400
`BAD_FORMAT`, and a `size` in the body is ignored for thumbnails (not even validated). The export menu defaults to 3×
("4K, YouTube's recommended size") and JPG for thumbnails, 1.5× stays "1080p", and after an export it
shows the file size, warning when it is over 2 MB (too big for the mobile app, fine on desktop;
choose JPG if it was PNG). JPG quality is 0.92 by default (`render.cjs`, `--quality` changes it).

**Graphic sizes** (`GET /api/presets` gives each a `group`; the UI lists them in a select with
groups, plus Custom). Print sizes are at 150 dpi. The Facebook cover is 1640×624, twice its 820×312
desktop display size; its link image is 1200×630.

| Group | Sizes |
| --- | --- |
| Instagram | post 1080×1080, portrait 1080×1350, story/reel 1080×1920 |
| Facebook | post 1080×1080, link 1200×630, cover 1640×624, event cover 1920×1005 |
| X / Twitter | post 1600×900, header 1500×500 |
| LinkedIn | square 1200×1200, landscape 1200×627, banner 1584×396 |
| YouTube | channel banner 2560×1440, thumbnail 1280×720 |
| TikTok, Pinterest | 1080×1920; pin 1000×1500 |
| Twitch, Discord | banner 1200×480, offline 1920×1080; banner 960×540 |
| Web | Open Graph 1200×630, hero 1920×1080, blog 1600×900, email 1200×600 |
| Print (150 dpi) | A4 1240×1754, A5 874×1240, US Letter 1275×1650, poster 18×24 in 2700×3600 |
| Screens | desktop 1920×1080, phone 1170×2532, slide 1920×1080 |
| Audio, Brand | podcast cover 3000×3000, avatar/logo 1000×1000 |

**Export scale guard.** An export's longest edge is at most 8192 px. Measured with the real
renderer: 3840×3840, 5400×7200 (2700×3600 at 2×) and 8192×8192 render correctly; 12288×12288
(4096 at 3×) loses content ("tile memory limits exceeded"). So the UI hides scales over the limit
and the server answers 400 `BAD_SCALE`.

## Thumbnail craft, concept prompts and fonts

The thumbnail preset's detail lives in files, not in the system prompt. `presets/thumbnail.md` is the
lean core (rules, and which craft file to Read); the method is in `server/presets/craft/thumbnail/`.

**Craft files.** `index.md` (what to read when), `honesty-and-title.md`, `face-finishing.md`,
`vertical.md` (Shorts, Reels, TikTok: 3:4 centre crop, overlay zones, sources with access dates),
`square.md` (podcast 1:1), `judging.md` (the feed mock-up and what to do about each check id),
`kit.md` (using the "From the video" material), and `archetypes/<id>.md` for the eight archetype ids
`reaction`, `result-reveal`, `before-after`, `versus`, `number`, `curiosity-gap`, `object-hero`,
`story-moment` (`THUMBNAIL_ARCHETYPES`). Each archetype file has Fits when, Layout (16:9, 9:16, 1:1), Text
and Fails when.

**Delivery.** Claude's tools reach only the project folder and may write only `design.html`, so the
files are copied into `<project>/reference/craft/<preset>/` by `installCraft(project, projectDir)`
(`presets/index.mjs`), which `runTurnInner` calls once per `claude -p` attempt, before the system
prompt is written. It replaces the previous copy (the rest of `reference/`, including
`style-reference.html`, is left alone), does nothing for a preset without a `craft/<preset>` folder, and
a failure to copy never fails the turn. The files are read-only to Claude, never served over HTTP, and
a changed prompt therefore reaches existing projects on their next turn. A concept or planner turn
gets them through the same call.

**Platforms.** `brief.platforms` is an array of `youtube-shorts`, `instagram-reels`, `tiktok` (`PLATFORMS`,
`briefPlatforms()` ignores unknown ids and repeats). With `brief.format === "shorts"` and at least one
platform, `buildSystemPrompt` adds a `Platforms:` line under "This project": the key zone
(x 48-590, y 190-960 on the 720x1280 canvas), and each platform's overlay needs. The field is
optional and the system prompt is unchanged without it. The form field itself belongs to the UI.

**Concept prompts** (run by the concept-set code, not by `runTurn`):

- `planner.md`, placeholders `{{count}}` (concepts wanted) and `{{format}}`: the planner's system
  prompt, built with `plannerSection({count, format})`. It does not use `design-rules.md` or
  `thumbnail.md`. A planning turn needs Read and Glob, `Edit(./concepts.json)` (file writes are granted as `Edit` rules; a `Write(...)` path rule is not honoured) and no `render` or
  `cut_out`, and may Read the kit's files in `assets/` (named in its first message, with the contact
  sheet when there is one) and `reference/craft/`. It writes `{"concepts": [...]}` in the shape of the
  plan (`archetype`, `label`, `idea`, `text`, `frame?`, `face?`, `pictures?`, `why`). The wiring validates the file
  (distinct archetypes in `THUMBNAIL_ARCHETYPES`, `text` of at most 4 words, `frame` and `pictures` paths
  that exist, `face` (when given) the id of a usable pack face; see "Face pack") and falls back when it fails; the prompt asks for exactly that.
- `concept.md`, placeholders `{{concept}}` and `{{siblings}}`: a section appended to a design turn's
  system prompt (after `thumbnail.md`, series and further sections), built with
  `conceptSection(concept, siblings)`. `describeConcept()` renders a concept as plain lines and the siblings as
  `Concept 1`, `Concept 2`, ... blocks, `(none)` when there are none. Both builders replace only the
  placeholders named above.

**Fonts.** `fonts/fonts.json` and `fonts/fonts.css` list the content fonts; any family there is accepted by the
validator and offered to Claude ("Content fonts" in the system prompt). Added for thumbnails, all vendored as TTF from
the google/fonts repository with their licences in `fonts/licenses/`: Archivo (variable, weight 100-900 and
width 62-125, Fabula's display face), Montserrat (variable, heavy geometric), League Gothic (variable
width, condensed), Lilita One (rounded), Bangers (comic), Bowlby One (fat soft poster), Permanent
Marker (hand marker, Apache-2.0; the others are SIL OFL 1.1). A face with a width axis carries a
`stretch` range in `fonts.json` and a `font-stretch` range in `fonts.css`.

Brand v2's three faces are content fonts too (SIL OFL 1.1, the google/fonts variable TTFs with every axis, licences
in `fonts/licenses/`): **Fraunces** (weight 100-900 plus `opsz` 9-144, `SOFT` 0-100 and `WONK` 0-1), **Commissioner**
(weight 100-900, `slnt` -12-0, `FLAR` 0-100 and `VOLM` 0-100) and **Spline Sans Mono** (weight 300-700). A
family's non-weight axes are listed under `axes` in `fonts.json` (`{tag: [min, max]}`), which is what brands validate
`font-variation-settings` against; `fonts.css` declares the weight range (and Commissioner's oblique range), so
`font-variation-settings: "SOFT" 100, "WONK" 1, "opsz" 144` works in a design. The tests render it: Fraunces 850 with those
settings differs from the defaults, and so do Commissioner's `FLAR` and `VOLM`. Only OFL or Apache-2.0
faces may be added.

## Fabula kits

Fabula's thumbnail kit, schema v1 (the shared plan is `Instrumenta/docs/suite/thumbnail-uplift.md`), is the one
thing Imago takes from a Fabula project. Imago reads only `<root>/<project>/out/thumbnail-kit/kit.json` and the image
files it names, under the roots in `IMAGO_FABULA_PROJECTS`; never anything else of a Fabula project.

**Validation (`server/kits.mjs`, strict).** A kit is refused, with a reason that never contains a path, when: `kind`
is not `instrumenta.thumbnail-kit` or `schemaVersion` is not 1; `kit.json` is over 1 MB, not JSON, or any field has
the wrong type (`source.format` not `landscape|vertical|square`, a tag outside `smile, laugh, surprise, intense,
speaking, pointing, neutral`, a hook kind outside `promise, claim, number, question, quote`, a colour that is not
`#RRGGBB`); there are more than 12 face frames, 6 screen frames, 12 pictures or 6 hooks; a `file` is not exactly
`frames/<leaf>` (or `pictures/<leaf>` for a picture) with a safe leaf and an image extension, or is listed twice; a
named file is missing, is not a regular file, resolves (symlinks included) outside the kit folder, is over 25 MB, or
is not a real PNG, JPEG or WebP by its header (over 100 megapixels is refused too); the kit folder itself resolves
outside its root. Text fields are stripped of control characters and capped. The declared `width`/`height` must be
positive integers; the image's own header is what is stored. A refused kit is not listed (it shows under `rejected`).

**API.** `GET /api/kits` lists valid kits newest first (`createdAt` of the kit): `{id, title, project, format
(landscape|vertical|square), thumbnailFormat (video|shorts|podcast), createdAt, durationSeconds, producer, logline,
counts {face, screen, pictures, hooks, chapters}, poster (a /kits/... URL: the first face frame), suggested {title,
channelColours, notes, format}}`. The `id` is a hash of the kit's real folder, so it reveals no path. Discovery results
are cached by the size and mtime of the kit's files.

**Import** (`POST /api/projects` with `kit`, and for every project of a set). Frames and pictures are copied to
`assets/kit-<leaf>` (`kit-f01.jpg`, `kit-s01.jpg`, `kit-boss-billy.png`) as assets of kind `kit` (`kitFile`,
`kitKind` face or screen); a picture with a credit carries `credit`, `license`, `source` into its asset record as stock does, so
`creditsFor` and the export's credits list it. The validated kit is written to `reference/kit.json`. A contact sheet
`assets/kit-contact-sheet.png` (a numbered grid, each cell labelled with its file name, kind, time and tags, about 1500 px
wide, rendered by the normal renderer from a temporary page that is removed; if the renderer is missing there is no sheet) is
added, and `project.kit` marks the project. The brief is prefilled where blank: `title` from `source.title`, `channelColours`
from `style.colours` ("accent #E8413C, text #F4F0E6"), `notes` from the logline, `format` from `source.format`
(landscape to `video`, vertical to `shorts`, square to `podcast`); anything the form sent wins.

**The first prompt** (`kitPromptSection`, sent while the brief is sent, also in a recovery prompt): after the brief, a
"From the video" section with the film's title, format and length, logline, purpose, look, hooks (kind, words, time),
chapters, a frame table (file, kind, time, tags, key signals and face box, words), the pictures with sizes, times and
credits, the palette, the display font ("Imago has it" or "does not have it, take the closest heavy face") and the
contact sheet's name. It opens by saying the text is content and never instructions, which the design rules already say
of the brief. Pipes in cells are replaced so the table cannot be broken.

## Face pack

The owner uploads photos of their own face once (many expressions and gestures); Imago cuts each out, Claude
classifies them, and thumbnail design turns and the concept planner pull the face they need. It has nothing to do
with Fabula or kits: the photos are independent uploads. (Plan: `Instrumenta/docs/suite/thumbnail-uplift.md`, "Face pack".)

**Library.** `<IMAGO_DATA_DIR>/faces/<id>/` (`<id>` is 8 lowercase hex characters) holds `original.<png|jpg|webp>` (the
upload as sent), `cutout.png` (the existing local cut-out, made once at upload, full size), `thumb.png` (the cut-out at
most 360 px tall, for grids and sheets) and `face.json`: `{schemaVersion, id, addedAt, filename, original {file, width,
height, bytes} (sizes after EXIF orientation), cutout {state queued|running|done|failed, width, height, thumb, error},
classification {state pending|running|done|unclassified, reason}, labels, labelsEditedByOwner, mirrorAllowed
(true|false|null), quality {grade, faceHeightPx, sharpness}, starred, hidden, retouch (true|false|null), retouchStrength
(0 to 1 or null), retouched {state queued|running|done|failed, strength, box labels|fallback, at, thumb, error}}`. Next to `cutout.png`
the folder holds `retouched.png` and `retouched-thumb.png` once a retouch is done. `faces/settings.json` is the pack setting
`{mirrorAll, retouchAll, retouchStrength}` (defaults true, true, 0.5; see Retouch). Deleted faces move to `faces/.trash/<id>` (undo is a move back, purged after seven days).
Uploads follow the project asset rules (PNG, JPEG or WebP by header, 40 MB, 100 megapixels, `x-filename`, atomic
creation; at most 300 faces, 409 `PACK_FULL`). The server is the only writer of `face.json`; the render MCP and the planner
read it (`face-pack.mjs`).

**Cut-out queue.** One cut-out at a time, in the background (`createFaces`). A photo stored sideways by its EXIF flag is
cut out upright. A failed cut-out is reported (`stage: "failed"`, `POST /api/faces/:id/recut` retries). After a restart a
cut-out that was running is queued again; a classification that was pending is marked unclassified ("Press Reclassify")
rather than silently spending usage.

**Retouch** (`face-retouch.mjs`; local, classic photo retouching with sharp and typed arrays; no model, no subscription). It
makes `retouched.png` from the cut-out: the same size, the same alpha byte for byte, and never any reshaping, so tone and
texture only. Each step is scaled by `strength` (0 to 1, default 0.5, chosen by looking at fifteen of the owner's own photos:
at 0.5 the skin keeps its pores and the beard its texture, at 1 it starts to look pasted):

1. *White balance*, measured on the skin inside `faceBox` (skin-coloured pixels in YCbCr, alpha 240 or more): the skin's R/G and
   B/G are pulled toward a healthy band (R/G 1.14 to 1.40, B/G 0.74 to 0.90), never past its edge, gains held within 0.85 to 1.2
   and luma preserved.
2. *Exposure and levels*, one luma curve applied as a luma ratio so hue and saturation hold: the skin's median luma is brought
   toward 0.58 by gamma (gamma 0.7 to 1.15, so a face below that is lifted, one between 0.58 and 0.72 is left alone and one
   over 0.72 eases down), lifted shadows are weighted away from black (below luma 0.07 nothing moves, so a black T-shirt
   stays black), and a gentle sine S-curve of contrast (0.08 x strength) pivoted on the lifted skin, so contrast deepens
   what is darker than the face and never pulls the skin itself duller. Highlights keep their hue rather than clipping a channel.
3. *Warmth and vibrance* on the mid-tones: R up and B down by up to 3.5%, capped so the skin's R/G never passes the band's top
   plus 0.05 (never orange), and a saturation lift that favours weakly saturated colours.
4. *Skin smoothing*, edge-preserving: a guided filter (guide: luma, radius 1.1% of the face height, eps 0.0025, two passes)
   blended in by mask x strength x 0.55. The mask is built from `faceBox` (grown a little to take in neck and ears and
   feathered), skin-colour likelihood, the alpha, minus anything dark relative to the face's skin (hair, brows, lashes, beard,
   pupils, spread outward) and minus high-gradient pixels (eyes, lips, edges). Colour under the cut-out's soft rim is replaced
   by the subject's own colour spread outward, so the rim does not darken.
5. *Redness*: skin redder than its surroundings (R minus the mean of G and B, against a large local average) is reduced by
   0.75 x strength in the mask, giving a quarter of it back to G and B so a spot does not turn into a dark patch.
   *Blemishes* (after redness): spot healing by frequency separation. Skin redder or darker than a wide, skin-only blur of
   its surroundings (acne, marks, the light-and-shadow bump of a raised spot) takes that surrounding colour at low frequency
   while its fine texture stays on top, so pores and beard keep their detail.
   *Teeth* (after redness): teeth are found in the mouth area of `faceBox` without landmarks, as pixels much brighter than
   their surroundings and much less red for their brightness than skin. Confident seeds are grown through looser tooth-like
   pixels connected to the strongest seed, short gaps along the row are bridged, and stray fragments dropped. They are evened
   out a little, lose up to 45% of their chroma and gain up to 6% in brightness, capped at 0.9 so they read as clean teeth,
   not veneers. A closed mouth finds nothing.
6. *Sharpening*: a luma unsharp mask over the whole subject (fine radius 0.07% of the height, 0.55 x strength, plus a wide
   "clarity" term of 0.18 x strength), alpha-weighted so the outline does not halo, 40% gentler on skin and clamped to
   +-0.09 per pixel.

The cut-out's colours equal the photo's under the alpha (measured: a mean difference under 0.1 level), so the skin is measured
on the cut-out. Cost: about 2.5 to 4.5 s per face of 3392 x 2544 on the dev machine. Without a face box the retouch guesses
one from the cut-out (`fallbackBox`: the head at the top of the subject); the queue redoes it with the classifier's real box
once the labels exist (`retouched.box` says which it used).

*Settings.* Pack `retouchAll` (default on) and `retouchStrength` (default 0.5); per face `retouch` (`true`, `false`, or `null`
to follow the pack) and `retouchStrength` (or `null`). The effective values: `retouchOn` and `retouchStrengthFor` in
`face-pack.mjs`. `PUT /api/faces/settings` takes any of `mirrorAll`, `retouchAll`, `retouchStrength` (0 to 1) and keeps the rest;
`PATCH /api/faces/:id` takes `retouch` and `retouchStrength`. A new upload is retouched right after its cut-out, in the same
one-at-a-time background queue (a retouch is served before the next cut-out), and again when its labels arrive; changing a
face's choice or strength, or the pack's `retouchAll` or strength for the faces that follow the pack, queues what is out of
date. `POST /api/faces/retouch {ids?}` (202 `{ok, changed, skipped}`) retouches the named faces, or all, again at the effective
strength; a face whose own choice is off, or that is not cut out yet, is skipped. A restart re-queues retouches that were
running. The quality grade is always computed from the original photo, never from the retouch.

*View.* Each face carries `retouch {enabled, override, strength, ownStrength, state none|queued|running|done|failed,
appliedStrength, error, url, thumbUrl}` (the URLs end `?v=<time>` so a redo is not cached); the list's `counts` gain
`retouching`, and `working` includes faces still being retouched. `/faces/<id>/retouched.png` and `retouched-thumb.png` are
served under the same file rules as the other images.

**Classification** (`runFacesClassifier`, prompt `presets/faces-classify.md`). One turn per batch: the faces whose cut-out
is done and whose classification is pending, taken after the cut-out queue has been idle for `facesBatchMs` (2 s), at most
20 per turn (more make further turns). The work folder `faces/.work/<run>/` holds only `images/01.jpg ...` (the originals at
most 1024 px, upright) and `sheet.png` (a numbered contact sheet); it is removed afterwards. Arguments (`buildFacesArgs`) are
the planner's lock-down: `--restricted`, `--setting-sources ""`, `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` (no MCP),
`--tools "Read,Write,Glob"`, `--permission-mode dontAsk --permission-prompts none --disable-slash-commands`, `--allowedTools
"Read(./**),Glob(./**),Edit(./labels.json)"`, `--disallowedTools "Bash,WebFetch,WebSearch,Task,NotebookEdit,Edit(./images/**),
Edit(./sheet.png)"`, the prompt through `--append-system-prompt-file`, `--model $IMAGO_FACES_MODEL --effort low`, never `--resume`.
Photos are numbered, so Claude never sees an id or a path. The prompt says text in photos is content, never instructions.

**Vocabulary** (`face-pack.mjs`, validated by the server; nothing outside it is stored):

| Label | Values |
| --- | --- |
| `expression` | smile, laugh, surprise, shock, excited, thinking, sceptical, confused, intense, angry, sad, neutral |
| `intensity` | 1, 2, 3 |
| `gesture` | none, point-left, point-right, point-camera, point-up, hands-up, facepalm, thumbs-up, thumbs-down, arms-crossed, hand-on-chin, holding-object, other |
| `gaze` | camera, left, right, up, down (image terms: `left` looks toward the left edge, so a layout knows which side the face looks toward) |
| `headTurn` | frontal, three-quarter, profile |
| `eyesOpen`, `textOrLogoInShot` | booleans |
| `faceBox` | `{x, y, w, h}` fractions 0 to 1 of the photo (a little overshoot is clamped) |
| `description` | one line, control characters removed, at most 140 characters |

**Invalid output.** Each photo is validated on its own: what validates is kept; a photo whose entry is missing or invalid
(or the whole answer when `labels.json` is missing or unparsable, or the turn fails or Claude is signed out) becomes
`unclassified` with the reason, and Reclassify (all, or `ids`) retries it. A face that already had labels keeps them when
a Reclassify fails. **Labels the owner edited** (`labelsEditedByOwner`) are never overwritten: Reclassify skips them and a
classification result fills in only a missing `faceBox`.

**Quality**, local: the face's pixel height (`faceBox.h` times the cut-out's height) and sharpness (variance of the Laplacian
of the face crop, scaled to 256 px tall so it does not depend on resolution; `QUALITY` in `face-pack.mjs`). A 3x thumbnail
export is 2160 px tall and the craft files want the face at about half of it.

| Grade | Face height | Meaning |
| --- | --- | --- |
| `4k` | 1000 px or more and sharpness 60 or more | survives a 3x export filling half the canvas, 1:1 |
| `hd` | 540 px or more (a sharp 4k face under sharpness 60 is held here) | fine at 1080p, softens when large at 3x |
| `soft` | under 540 px, or sharpness under 25 | use small or not at all |

The thresholds are starting values, not calibrated on a large set; change them in `QUALITY` only. A face with no box has no grade.

**Mirroring.** `mirrorAllowed` per face is the owner's choice (`true` or `false` wins); `null` follows the pack setting
`mirrorAll` (default on: the owner is happy for every face to be mirrored); with `mirrorAll` off a face may be mirrored only
when Claude saw no text or logo in the shot (`textOrLogoInShot` stays Claude's label). `use_face` with `mirror` is refused only
when the effective value is false (`mirrorAllowedFor`).

**Tools** (render MCP; the MCP reads `<IMAGO_DATA_DIR>/faces/` directly):

- `find_faces({expression?, gesture?, gaze?, minGrade?, count?})` returns the best matches (`count` 4 by default, at most 8): usable
  faces only (cut out, classified, not hidden), ordered starred first, then grade, then 0.6 sharpness (capped at 200) plus 0.4
  recency. The result is a contact sheet image (numbered, with id, expression, gaze, grade) and JSON `{faces: [{n, id, expression,
  intensity, gesture, gaze, headTurn, eyesOpen, textOrLogoInShot, mirrorSafe (the effective mirroring), retouched (use_face would give the retouched image), grade, faceHeightPx, width,
  height, starred, description}], packHas: {expression: count}, note?}`. The sheet is a help; without a renderer there is none.
- `use_face({id, mirror?, sticker?})` copies the face image (`retouched.png` when the effective retouch is on and done, else `cutout.png`; the description tells Claude pack faces arrive retouched and must not get heavy CSS filters) to `assets/face-<id>.png`, or with `mirror` writes `assets/face-<id>-mirrored.png`
  with the pixels flipped (sharp), and returns `{name, id, mirrored, width, height, grade, faceHeightPx, retouched, stamp, sticker?, display?}`. It refuses a hidden or not
  ready face and a mirror that is not allowed. The server then registers the copy (kind `face`, with `stamp`, `sticker`, `display`) from that result, falling back to a sync of `assets/`.
  **Every output is at most 2400 px on its long side** (a 3392 px cut-out was up to 12 MB and made every render slower); a face that already fits is copied byte for byte. The pack keeps the full-size files.
- **Baked sticker outline** (`sticker: true | {cream?, ink?, displayWidth?, creamPx?, inkPx?}`, `face-sticker.mjs`). A cut-out under 9 to 14 stacked `drop-shadow()` filters made a 3x render take 20 to 40 s (a 1x render of one 3392 px cut-out under twelve measured 23 s and then hit the 40 s render timeout; the same design with the outline baked renders in 0.75 s at 1x and 2.4 s at 3x), because Chromium rasters every filter over the whole image. The outline is drawn once into the PNG: the subject's alpha (a pixel with alpha 8 or more is the subject) is grown by an exact circle (a distance transform, not a blur and a threshold, so the radius is the radius asked for), the ink band reaching `inkPx` CSS px from the subject and the cream band `creamPx`, composited ink, then cream, then the subject, with a one-pixel soft edge. The image is scaled so the padded result is at most 2400 px on either side. `cream` and `ink` are hex colours; left out they are the project's brand snapshot's `light` and `ink` colours, else `#F6EFDC` and `#15130F`. `displayWidth` (default 800) is the CSS width the design shows the face at, which is what `creamPx` (default 8) and `inkPx` (default 13) are measured at. The outline adds a margin all round, so the reply's `display {width, height, offset}` gives the CSS size to show the baked image at and the offset to subtract from its left and top so the face sits where the plain cut-out would. The mirror is applied before the bake. A bad colour or number is an error from the tool. The prompts (`face-finishing.md`, `thumbnail.md`, `design-rules.md`) tell Claude to use it, to keep one hard `drop-shadow()` in CSS and never to stack more than 5 `drop-shadow()` filters on one element.

**Planner and concept sets.** When the pack has usable faces, the planning folder gets `faces/sheet.png` (starred first, then
the best of each expression, at most 24, numbered), `faces/faces.json` (the same faces with their labels, grade and `mirrorSafe`,
and the pack's total) and `faces/<id>.png` thumbnails; the first message says so. `concepts.json` may carry `face` (a pack
id; unknown or unusable ids make the plan invalid, which falls back). Concepts that name the same face get different ones where the
pack has more (`diversifyFaces`). The fallback uses pack faces, different per concept, only when the video and uploads offer no
real frame of a person. Before a concept's design turn its face's cut-out is copied into its project as `face-<id>.png` (kind
`face`) and named in the first message; concept prompts say the face may be mirrored (when allowed), must match its gaze to the
text side and respect its grade. Honesty: a reused face is fine, but it may not stand in for a moment or result the video does
not have (planner.md, thumbnail.md and `face-finishing.md` say so).

**API.** `GET /api/faces` `{items: [face view], counts {total, ready, hidden, working, unclassified}, model, settings {mirrorAll}, lastRun}`
(the UI polls it every second while anything is in progress); a face view is `{id, addedAt, filename, stage queued|cutting|classifying|ready|unclassified|failed,
error, original {width, height, url}, cutout {state, width, height, url, thumbUrl}, labels, labelsEditedByOwner, mirrorAllowed, quality,
starred, hidden, classification}`. `POST /api/faces` (raw image, `x-filename`) 201 face view. `PATCH /api/faces/:id`
`{starred?, hidden?, mirrorAllowed?, labels?}` (labels are partial edits against the vocabulary, 400 `BAD_LABELS`; an edit marks them as the owner's;
400 `INCOMPLETE_LABELS` when a face with no labels is given too few). `DELETE /api/faces/:id` (to the trash), `POST /api/faces/:id/restore`,
`POST /api/faces/:id/recut` (409 `NOT_FAILED`), `POST /api/faces/reclassify {ids?}` `{changed, skipped}`, `GET|PUT /api/faces/settings`
`{mirrorAll}`. Files: `/faces/<id>/original.<ext>`, `cutout.png`, `thumb.png` only, `Cache-Control: no-store`, `nosniff`, `Content-Security-Policy:
sandbox; default-src 'none'`; 404 for anything else (`face.json` included).

**UI.** The **Faces** page (`/faces`, nav link): multi-upload (drop, choose, paste) with an upload bar and per-photo stage on each tile (waiting,
cutting out, labelling), the pack-wide mirroring checkbox ("Mirroring: allowed for all faces unless I say otherwise"), filters by expression, gesture and
gaze plus starred and show hidden, a grid of cut-outs on a checker ground with the quality badge, star, hide and delete (with a six-second Undo), an edit dialog
(labels, per-face mirroring, retry for failed or unclassified), Reclassify, and an empty state saying what to upload. The thumbnail start form shows "Your face pack: N faces,
Claude picks." when the pack has ready faces.

## Brands

A brand is a reusable visual identity: fonts, a palette, signature devices, optional logo or mascot files and
guidance. It constrains **type and colour**; layout, archetype, composition, imagery and cropping stay free. That is
the difference from a series, whose style reference fixes the layout exactly. (`server/brands.mjs`.)

**Data.** `<IMAGO_DATA_DIR>/brands/brands.json` is `{schemaVersion: 1, brands: [...]}`, written atomically and
serialised; assets live in `<data>/brands/<id>/assets/`. A brand:
`{id, name, description, colours [{name, hex, role}], fonts {display, support, mono?} (each {family, weight?, settings?}),
devices [string], guidance, assets [{name, kind logo|mascot|other, note, width, height}], isDefault, createdAt, updatedAt}`.
`id` is a slug plus four hex characters. Validation (`validateBrandFields`): name 1-60 characters and unique
case-insensitively (409 `EXISTS`); 1 to 12 colours, `hex` `#RGB` or `#RRGGBB` (stored upper-case, 6 digits; 400 `BAD_HEX`), `role`
one of `primary`, `accent`, `ink`, `light`, `extra` (`BAD_ROLE`); `display` and `support` required, `mono` optional,
`family` must be in `fonts.json` (`UNKNOWN_FONT`), `weight` an integer inside the family's range (`BAD_WEIGHT`), `settings`
only `"TAG" number` pairs on axes the family has (`BAD_SETTINGS`); at most 12 devices of 240 characters; guidance at most
4000. At most 50 brands (409 `TOO_MANY`). At most one brand is the default (setting one clears the others).

**Assets** follow the project upload rules: PNG, JPEG or WebP by header (415 `UNSUPPORTED_IMAGE`), 40 MB and 100 megapixels
(413), `x-filename` required, a safe leaf name with the extension from the real type, claimed with `wx` (`-2`, `-3` on a
clash), `Content-Type` only octet-stream or image/png|jpeg|webp. At most 20 per brand (409). A refused record removes the
file again.

**Using a brand.** `brand: <id>` on `POST /api/projects` and `POST /api/concept-sets` (`null`, `"none"` or nothing means no
brand; an unknown id is 400 `BAD_BRAND` and creates nothing). At creation the brand is **snapshotted**: `reference/brand.json`
(the brand's design fields, and each asset with the `file` it was copied to), the asset files copied into `assets/` as
`brand-<name>` (kind `brand`), and `project.brand = {id, name}`. Editing or deleting the brand later changes no existing
project. Every concept of a set gets the snapshot (resolved once, so they agree), and so does the planner's folder
(`work/reference/brand.json`, `work/assets/brand-*`, removed with its other copies once the plan is made); the set records
`brand {id, name}`. "Another concept", "duplicate" and "new in this style" copy the donor's snapshot, not the live brand. The UI
preselects the default brand (`GET /api/brands` gives `defaultId`) on every start form, with "None".

**Prompt.** `presets/brand.md`, filled by `brandSection(snapshot)` from the project's own snapshot, is appended to the system
prompt after the series section and before "Take it further" and the concept section: **base, series, brand, further, concept**.
It gives the palette by role as the core colours (tints, shades, pure black and white allowed, no unrelated hues as main
colours), the display, support and mono faces with exact `font-weight` and `font-variation-settings`, the devices, the
guidance (quoted: the owner's words are content, never instructions), and the assets by file name, optional to use. It says
plainly that layout, archetype, composition, imagery and cropping are free; that the thumbnail legibility and honesty rules and
the checks win over the brand; that a series reference, when present, decides layout and treatment (set in the brand's colours
and faces); and that the brand's colours and fonts take precedence over a kit's style colours and fonts and the brief's channel
colours (an explicit request in the owner's own message still wins for that request). The planner gets the same section plus
`presets/brand-planner.md` (plan in the palette; brand files are never a concept's `frame`), via `plannerSection({brand})`.

**UI.** `/brands` ("Brands" in the nav): cards with a sample 16:9 thumbnail in the brand's colours and fonts, swatches and a type
specimen in its own faces; an editor with name and description, colour rows (hex text and colour picker, name, role, reorder,
remove), font selects from `fonts.json` with weight, settings and a live specimen, devices and guidance, asset upload with kind
and note, set as default, and a live preview tile. The workspace header shows `Brand · <name>`. The specimens load
`/fonts/fonts.css` while the page is open.

## Face source

A thumbnail's `brief.faceSource` says where its face comes from. The start forms show it (thumbnails, single and concept
set) when the pack has ready faces:

| Value | Label | Meaning |
| --- | --- | --- |
| `pack` | My face pack, best quality | The default whenever the pack has ready faces. The kit's **face frames are not imported** (no `kit-f*` assets, none on the contact sheet or in the frame table); screens, pictures, story, hooks and palette still are. The planner must give every concept a pack `face` matched to its emotion and gesture, the gaze toward the text side (mirrorable per the pack settings), a different face each where the pack has enough; a plan without them is invalid (fallback). Design turns use the face placed in `assets/` and `use_face`. The fallback concepts use pack faces, even when the video has frames or the owner uploaded photos |
| `video` | Frames from the video | Only offered with a kit; the previous behaviour (the default when the pack has no ready face) |
| `auto` | Claude decides | Kit face frames are imported and **graded** with the pack's own function (`gradeOf`/`qualityOf`, sharpness measured on the face crop): the grade is on the kit contact sheet and in a `quality` column of the "From the video" frame table, and Claude picks the best face by fit and quality |

`POST /api/projects` and `POST /api/concept-sets` take `brief.faceSource` (400 `BAD_FACE_SOURCE`; 400 `NO_PACK_FACES` for `pack` with
no ready face); left out it is resolved as above. The first message carries a `Face source:` line (`FACE_SOURCE_LINES`). A pack
face beside the video's own art and screens is honest; a pack face standing in for a specific moment, result or reaction the
video did not capture is not (`kit.md`, `planner.md`, `concept.md`, `thumbnail.md` and `face-finishing.md` say so).

## Concept sets

A set is N (2 to 4 at the start, up to eight with "another concept") thumbnail concepts for one video, designed in
parallel and compared. Its record is `<IMAGO_DATA_DIR>/concept-sets/<id>/set.json` (`{id, title, format, count, state,
kit, kitAssets, brief, plan {source, note, concepts}, costUsd, members [{index, projectId, state, error, concept}]}`),
written atomically and serialised per set. States: set `draft`, `planning`, `designing`, `done` (at least one concept
done), `failed`, `cancelled`; concept `planning`, `waiting`, `designing`, `done`, `failed`, `cancelled`. Each concept is an
ordinary project with `conceptSet: {id, index, archetype, label}` (so the feed's neighbour rule excludes its siblings, and
`IMAGO_CONCEPT_SET` reaches render-mcp) and its own `reference/kit.json`, kit assets and craft copy.

**Flow.** `POST /api/concept-sets` creates the set and N projects without a turn (photos may then be uploaded to the set,
which copies them to every project), `POST .../start` begins:

1. **Planning turn**, in the set's own folder `<set>/work/` (decision: not the first concept's folder, so the planner's
   Claude session never becomes a concept project's, and the project folders hold only their own material). The folder
   holds copies of the kit images and the contact sheet, `reference/kit.json`, any uploaded photos and (copied in by
   `installCraft`) `reference/craft/thumbnail/`. The system prompt is `plannerSection({count, format})`; the first message is the
   brief, the "From the video" section and "Plan N different thumbnail concepts ... write concepts.json". Arguments
   (`buildPlannerArgs`): the same lock-down as a design turn, `--restricted`, `--setting-sources ""`, `--strict-mcp-config
   --mcp-config '{"mcpServers":{}}'` (no MCP tools at all, so no render or cut_out), `--tools "Read,Write,Glob"`,
   `--permission-mode dontAsk --permission-prompts none --disable-slash-commands`, `--allowedTools
   "Read(./**),Glob(./**),Edit(./concepts.json)"`, `--disallowedTools "Bash,WebFetch,WebSearch,Task,NotebookEdit,Edit(./assets/**),
   Edit(./reference/**),Edit(./exports/**)"`, the prompt through `--append-system-prompt-file`, on `IMAGO_MODEL`/`IMAGO_EFFORT`, never
   `--resume`. The timeout is the turn timeout.
2. **Validation** of `concepts.json` (`validateConcepts`): exactly `count` concepts, distinct archetypes from
   `THUMBNAIL_ARCHETYPES`, `label` (at most 40 characters), `idea` and `why` (at most 400) present, `text` a string of at most
   four words, `frame` and `pictures` (when given) paths `assets/<leaf>` that exist in the folder. Otherwise, or when the
   planning turn fails or writes nothing, **fallback**: `count` server-chosen distinct archetypes (`fallbackConcepts`: face-led
   ones first when the kit or uploads have a face, object-led otherwise), each on a different best face frame, with `text: null`
   (the designer chooses the words) and a note on `plan.note` saying so. Cancelling stops the set; a signed-out or missing Claude
   fails every concept with that message (the design turns would fail the same way).
3. The planner's copies (`work/assets`, `work/reference`) are removed once the plan is made; `concepts.json` stays.
4. **Cut-outs.** `cut_out` runs once per distinct chosen frame that is a kit face frame or an upload, in one concept's
   project; the result is copied into the other projects that use that frame and registered as a cut-out. The design turn's
   first message names it. A failed cut-out is ignored (the designer can cut out itself).
5. **Design turns**, one per concept in its own project through the normal turn path (so one-turn-per-project, cancel,
   timeouts, exports and delete all behave as for any project), at most `IMAGO_CONCEPT_CONCURRENCY` at once across the whole server. Each
   gets `conceptSection(concept, siblings)` appended last to its system prompt on that first turn only (later
   refine turns are ordinary), and the first message `Make concept N of M: "<label>" (<archetype>). ...`. One concept
   failing never fails the others; the set is `done` when any concept is, `failed` only when all are.
6. **Another concept** (`POST .../another`, only when the set is not draft or running): one more concept with an archetype
   not used yet, from `fallbackConcepts` (no planning turn, so it costs one design turn), in a project that gets the kit
   material copied from an existing concept, with every existing concept as its siblings.

Cost: a set of three is a planning turn plus three design turns, about four times one design; the start form says so. A set's
`costUsd` is the sum of Claude Code's `total_cost_usd` over its turns (an API-price estimate, not a charge).

A restart marks sets that were planning or designing as failed ("Imago was restarted"), as it clears `running` on projects.

**Set view** (`GET /api/concept-sets/:id`): `{id, kind: concepts|faces, titles, picked, source, title, format, state, createdAt, updatedAt, count, kit, plan {source:
planner|fallback|faces, note}, costUsd, testCompare (true for 16:9), concepts: [{index, forTitle, projectId, removed, state, error, archetype,
label, idea, text, why, frame, face, faceThumb, title, current, versionCount, running, renderUrl, checks {ok, warn, info, warnings [{id,
message}]}}]}` (`titles` and `forTitle` for a title test, `source` and `face` for a face set; see "Title A/B sets" and "Faces inside a project").

**SSE** `/api/concept-sets/:id/events`: `snapshot {set}`, `set {set}` after any change (coalesced to 120 ms; fed by the
projects' own events), `concept.progress {index, text}` (a concept's current tool, from its `tool.use`), `set.progress {text}`
(the planner's tools, cut-outs), heartbeat comments.

**Compare screen** (`/c/<set id>`, `screens/Compare.tsx`): the concepts side by side, each with its state, label,
archetype, idea and why, its current render, a `FeedPreview` among its siblings (and stand-ins), and a checks summary (the warn
count and the first three warnings). A shared surface and theme control. Actions: Refine (`/p/<id>`), Another concept, Cancel
(while running), and for 16:9 sets a Test & Compare zip with a tick per concept (at most three). A shorts set has a per-concept
"Covers" button instead. The Library shows a "Concept N · compare" badge on concept projects, and the workspace toolbar a link
back to the compare screen. The start form (thumbnails) has "From a Fabula video" (a kit picker with poster, title, date,
format, which prefills the form), a one design, three concepts or A/B test titles choice with the usage note, and, for the shorts format, a platforms
multi-select (all three by default).

### Title A/B sets

The owner A/B tests titles, one thumbnail per title. `POST /api/concept-sets {titles: [a, b(, c)], brief, kit?, brand?}` makes a set of
2 or 3 concepts, one per title (400 `BAD_TITLES` unless 2 or 3 different, non-empty titles of at most 100 characters; 400 `BAD_COUNT` when a
`count` is given and differs; `count` is otherwise left out). The set stores `titles`; each member stores its `title`, and
the concept's project has that title as its name and as its brief's title (so the feed mock-up and `text.repeatsTitle` judge it against its own).

- **The planner** gets `planner-titles.md` appended ("Title A/B test": concept N is the thumbnail for title N, it carries `"title": "<the
  title exactly>"`, and **the thumbnail never repeats its title**: the words on the image say what the title does not), and its first message
  lists the titles. `validateConcepts({titles})` requires concept N's `title` to be title N (compared by words, so case and spacing do not
  matter; the listed title is what is kept) and refuses a `text` whose every content word is one of its title's (`repeatsTitle`, using the
  checks' stop words), so such a plan falls back. The fallback still gives each concept its title (and `text: null`).
- **The design turn** sees `- Its title (an A/B test: ...)` in its concept and the title in its brief; siblings are listed with their own titles.
- **Another concept** is refused (409 `NOT_SUPPORTED`): a title test has one concept per title.
- **Test & Compare** names each file after its title (`thumbnail-<n>-<title slug>.jpg`) and adds `titles.txt` (`<file>\t<title>` per line) to the zip.
- The set view carries `titles`, and each concept `forTitle`. The compare screen shows each concept and its feed mock-up under its own title. The start form has an "A/B test titles" choice (two inputs, a third on request).

## Faces inside a project

`project-faces.mjs`, for what the server does with a project's pack faces without the owner typing to Claude.

**Is the copy stale?** `GET /api/projects/:id/face-status` is `{faces: [{id, state: current|stale|unavailable, assets, reason?}], stale}`. A pack face is stale for
a project when the pack file it would hand out now (`retouched.png` or `cutout.png`, by the effective retouch) differs from the recorded `stamp.file`
or has a later modification time than `stamp.mtimeMs` (an asset with no stamp is compared with its own file's time). `unavailable`: the face left the pack, was
hidden or is not ready.

**Refresh faces** (`POST /api/projects/:id/refresh-faces`, no body, no Claude turn): takes the project's turn slot (409 `TURN_RUNNING` while a turn, a restore or another refresh
holds it), copies every `face-<id>*` asset again from the pack (`takeFace`, keeping `mirrored` and the recorded sticker; a copy that can no longer be made, such as a mirror the owner has since forbidden, keeps its old file and is
reported in `skipped`; 409 `NOTHING_REFRESHED` when none could be, 409 `NO_FACES` when the project has no pack face), re-registers them with fresh stamps, then renders `design.html` as a new
version through `renderVersion` (the same files as a render from a turn: `versions/v<n>.html`, `renders/v<n>.png`, the feed mock-up and checks for a thumbnail), records it (`versions[]` entry with `note: "faces refreshed"`,
`current`, and a closing assistant message "Refreshed the face from your face pack (...). Nothing else changed." carrying the version) and emits `render.done` and `project` on the project's SSE stream.
422 `INVALID_DESIGN` when design.html no longer validates, 503 `RENDER_FAILED`. Reply `{project, version, refreshed: [name], skipped: [{name, reason}]}`. The earlier version stays restorable.
`GET /api/faces/:id/projects` is `{items: [{id, title, stale, busy}]}` (the projects holding a copy), and `POST /api/faces/:id/refresh-projects {all?}` refreshes just that face in each project whose copy
is stale (every one with `all: true`), one at a time, answering `{faceId, results: [{id, title, ok, version?, error?}]}`; one project failing does not stop the others.
UI: the workspace shows "Your face pack has a newer copy of a face in this design" with a **Refresh faces** button while a project has a stale face and no turn is running; the Faces page's edit dialog has "In your designs" with **Update in projects that use this face**.

**Try other faces** (`POST /api/projects/:id/face-variants {faces?: [ids] | count?}`, 201 set view): the design (a thumbnail with a render and a pack face in its `design.html`; 400 `NOT_THUMBNAIL`, 409 `NO_RENDERS`, 409 `NO_FACE`)
is duplicated once per face (`store.duplicate`, so versions, assets and brand come along, no session). `faces` is 1 to 6 pack ids that are ready and not hidden (400 `BAD_FACES`); with only `count` (1 to 6, default 3; 400 `BAD_COUNT`) the faces are picked
(`pickVariantFaces`): the best faces (`orderFaces`: starred, grade, sharpness and recency) with distinct expressions, never the face the design already uses, preferring expressions other than the design's own, then the next best faces
(409 `NO_FACES` when the pack has no other usable face). The face the design shows is the first pack face asset its `design.html` names; the new face is copied into each copy treated as the old one was (mirrored the same way when
allowed, with the same sticker outline) and registered. Each copy then gets **one face-swap turn** (`kind: "face-swap"` on `beginTurn`): the first message is "Change only the face. Replace assets/<old> with assets/<new> in design.html. ..." (with the new image's `display`
size when it is a sticker), and the system prompt gets `face-swap.md` ("change only the face"; no layout, text, colour or effect changes; render once). The turn is locked down further than a design turn:
`--allowedTools` is `Read(./**),Glob(./**),Write(./design.html),Edit(./design.html),mcp__imago__render,mcp__imago__use_face` (no `find_faces`, `cut_out` or stock tools), the rest as a standard turn. The turns run in parallel under
`IMAGO_CONCEPT_CONCURRENCY` through the concept-set machinery, as a set with `kind: "faces"`, `sourceProjectId`, no planner and members that start `waiting` with a `concept {archetype: null, label: "<Expression> face", idea, text: null, why, face}`.
Each copy's `conceptSet` points at the new set (so the workspace links back to the compare screen and the feed's neighbour rule excludes its siblings). The source design is untouched.
The set view carries `kind`, `source {projectId, removed, title, renderUrl}`, `picked`, and each concept its `face` and `faceThumb`. **Pick**: `POST /api/concept-sets/:id/pick {project}` stars that member and records `picked` (400 `NOT_A_MEMBER` otherwise); the others stay in the library, unstarred.
A face set refuses "another concept" (409 `NOT_SUPPORTED`). UI: a **Try other faces** button in the workspace toolbar (thumbnails with a pack face), a dialog with "Pick for me" (2 to 6) or "I'll choose" (a grid of pack faces), then the compare screen with the original beside the title, each card's pack face, **Pick this one** and **Refine**.

## Test & Compare and platform covers

**YouTube Test & Compare** (verified 2026-10-13; the page, YouTube Help "Test & compare thumbnails",
support.google.com/youtube/answer/13861714, and its successor "A/B test titles & thumbnails", support.google.com/youtube/answer/16391400):
up to **three** options per video; desktop only (YouTube Studio, advanced features enabled); **Shorts are not eligible**
(nor scheduled lives and premieres until they become ordinary videos; made-for-kids, mature-audience and private videos are
excluded; podcast episodes and live archives are eligible); resolution at least 1280×720, anything lower is downscaled to
480p; the page states **no file-size or format limit** (YouTube's general thumbnail limits are 2 MB on mobile and 50 MB on
desktop, which `Imago` meets anyway); changing the title or thumbnail during a test stops it, and a test finishes within two
weeks. So: only 16:9 sets offer it (400 `NOT_VIDEO` otherwise), and at most three concepts are exported.

`POST /api/concept-sets/:id/test-compare {projects?}` renders each chosen concept's current `design.html` (validated, its turn
finished: 409 `TURN_RUNNING` otherwise; 409 `NO_RENDERS` when none has a render; 400 `TOO_MANY` above three, so with more than
three concepts the owner chooses) at 3840×2160 as JPG, each under 2 MB, into `<set>/exports/<set id>-test-and-compare.zip`
(entries `thumbnail-<n>-<label>.jpg`). The reply is `{name, url, bytes, files: [{name, project, width, height, bytes, quality,
overBudget}]}`.

**Size budget.** `render.cjs` takes `--quality=<10-100>` (default 92) and `--max-bytes=<n>`: a JPEG over the limit is
re-encoded four quality points lower at a time, never below 40, and the result line says the `quality` used.
`renderHtml` forwards `quality` and `maxBytes`. The budget is `JPEG_BUDGET` = 1,990,000 bytes (under 2 MB however it is
counted); `overBudget` is true if even quality 40 did not fit (the file is still written).

**Platform covers** (`POST /api/projects/:id/platform-export`, Shorts canvases only, 720×1280): YouTube Shorts 2160×3840,
Instagram Reels 1080×1920, TikTok 1080×1920, all JPG under the same budget (1080×1920 is 1.5× the canvas, 2160×3840 is 3×).
One platform returns the JPG (`/projects/<id>/exports/<id>-v<n>-<platform>-<w>x<h>.jpg`), several a zip
(`<id>-v<n>-covers.zip`, entries `<platform>-<w>x<h>.jpg`). Reels and TikTok share one render. The workspace's Export popover
shows "Platform covers" with a tick per platform for a vertical thumbnail.

## Exports

A project's `exports/` folder is the owner's finished work, and the UI lists it so the filesystem is never needed.

- `GET /api/projects/:id/exports` is `{items: [{name, url, bytes, at, kind: "image"|"zip"}]}`: the jpg, jpeg, png, webp and zip files in `exports/`, newest first (other files are not listed). The workspace shows them under the preview ("Exports (n)") with a **Download** and a **Delete** each.
- `DELETE /api/projects/:id/exports/:name` removes one such file (400 `BAD_NAME` for any other name, 404 when it is not there).
- `POST /api/projects/:id/quick-export` (no body; 409 `TURN_RUNNING`, 409 `NO_RENDERS`, 422 `INVALID_DESIGN`, 503 `RENDER_FAILED`) is the one-click **Export**: the current design as a JPG at the largest scale up to 3x (a thumbnail: 3840 px wide, under the 2 MB budget; `overBudget` says when even quality 40 did not fit),
  rendered through `renderExport` like every export, written to `exports/<title slug>-v<n>.jpg` (so exporting again, or exporting an unchanged title, overwrites rather than piles up, and a title test's files carry their title) and answered `{name, url, width, height, bytes, overBudget}`.
  The workspace's Export popover leads with it ("Export 4K JPG"), the compare screen has an **Export** per finished concept; both download the file as well as keeping it. The popover's format and scale choices and the platform covers are unchanged and also land in the list.

## Design rules (validate.mjs, also told to Claude)

- `design.html` is a complete HTML document whose `body` is exactly `width`×`height` CSS pixels
  with `margin: 0` and `overflow: hidden`.
- There is no `<script>`, no `on*=` attribute, no `<iframe>`, `<object>`, `<embed>`, `<base>`,
  `<frame>`, `<frameset>`, `<applet>`, `<meta http-equiv>` or `<link>` other than
  `<link rel="stylesheet" href="/fonts/fonts.css">`, and no `javascript:` URL. Tag names are matched
  whatever follows them (`<script/x>`, `<iframe/src=x>`), and an `on*` attribute is caught after
  whitespace, `/` or a quote (`<img/src=x/onerror=...>`). The scanner is a backstop: the renderer
  also serves the design with a CSP that has no `script-src`, so a script that slips through never runs.
- Every `src`, `href` and CSS `url()` is either relative to the project (`assets/...`), the font
  sheet, or `data:`. Absolute and protocol-relative URLs are errors.
- Only families listed in `fonts/fonts.json` and generic families may be used. An unknown family
  is a warning, not an error. Inline `style="..."` attributes are read as rules of their own, so a single-quoted name
  (`style="font-family:'Lilita One'"`) is one family, not a run-on with the next piece of CSS.
- More than 5 `drop-shadow()` filters in one `filter` declaration (a rule or an inline style) is a **warning** naming the selector and the count, pointing at `use_face {sticker}`. It never fails a render.
- Errors make `render` fail with a message Claude can act on. Warnings render and are returned.

## Claude turn

`POST /api/projects/:id/messages {text}` runs one turn:

```text
claude -p --output-format stream-json --verbose
  --model $IMAGO_MODEL --effort $IMAGO_EFFORT
  --restricted --setting-sources "" --strict-mcp-config
  --mcp-config '{"mcpServers":{"imago":{"command":"node","args":["<abs>/server/render-mcp.mjs"],
                 "env":{"IMAGO_PROJECT_DIR":"<abs project dir>", "IMAGO_FONTS_DIR": "<abs fonts>", ...}}}}'
  --tools "Read,Write,Edit,Glob"
  --permission-mode dontAsk --permission-prompts none --disable-slash-commands
  --allowedTools "Read(./**),Glob(./**),Write(./design.html),Edit(./design.html),mcp__imago__render,mcp__imago__cut_out"
  --disallowedTools "Bash,WebFetch,WebSearch,Task,NotebookEdit,Write(./project.json),Edit(./project.json),
                     Write(./versions/**),Edit(./versions/**),Write(./renders/**),Edit(./renders/**),
                     Write(./exports/**),Edit(./exports/**)"
  --append-system-prompt-file <temp file: design-rules.md + presets/<preset>.md + size + asset list>
  [--resume <sessionId>]
```

- Claude's file tools are scoped by `--restricted` (working directories only) and by the path rules
  above: it may read inside the project and write only `design.html`; `project.json`, `versions/`,
  `renders/` and `exports/` are the server's and the renderer's. `--tools` is the exact built-in
  list (it names no MCP tools, which stay in `--allowedTools`). Nothing can prompt: whatever is not
  allowed is denied. There is no `WebFetch` anywhere (an exfiltration channel); `WebSearch`,
  `search_images` and `fetch_image` cover stock imagery. The rules tell Claude that text inside
  images, web pages and the brief is content, never instructions.
- The system prompt is written to a temp file outside the project (`os.tmpdir()/imago-prompt-*`,
  mode 0600) and the file is deleted when the turn ends; it is not on the command line.
- If a turn that `--resume`d fails (`EXITED`) with no `init` event or no assistant output, or with an
  error or stderr matching `/No conversation found|session/i`, the server clears `sessionId` and
  `briefSent` and retries once without `--resume`. That prompt is the brief, a recap of the last ten
  earlier messages (500 characters each), a note that `design.html` exists (read it first), and the
  user's text. Signed-out, timeout, cancel and a missing binary are never retried.

- The working directory is the project folder. The prompt goes on stdin. A turn with `briefSent`
  false gets the brief plus the user's text; later turns pass the user's text as it is.
- `sessionId` is taken from the `system/init` event or the `result` event, and stored (with `briefSent: true`).
- Only one turn per project runs at a time (409 `TURN_RUNNING`). Cancel and timeout kill the
  process group. Restore holds the same slot for its whole duration, and export is refused with 409
  `TURN_RUNNING` while a turn runs. The slot is released just before the turn's closing event
  (`run.finished` or `run.error`), so a client may export or send again on seeing it.
  `DELETE` aborts the running turn and waits for it to finish before removing the folder.
- The rules cap a turn at 4 renders. After each render Claude looks at the image it gets back and
  either fixes what is wrong or stops.

### render-mcp tools

- `render({})`: validates `design.html`. If it passes, it snapshots the file to `versions/v<n>.html`
  and renders it to `renders/v<n>.png` at scale 1. It returns
  `[{type:"image", ...the design}, {type:"image", ...the feed mock-up}, {type:"text", text: JSON {version, warnings, checks}}]`
  for a thumbnail (a photo or graphic gets only the design image and `{version, warnings}`). The
  mock-up is also saved as `renders/v<n>-feed.png`. The mock-up and the checks never fail a render:
  if either breaks, the design image and `{version, warnings}` still come back.
  On validation errors it returns `isError: true` with the list.
- `find_faces({expression?, gesture?, gaze?, minGrade?, count?})` and `use_face({id, mirror?, sticker?})`: the owner's face pack, see "Face pack". Allowed in standard and further turns (a face-swap turn gets `render` and `use_face` only).
- The render itself is `render-version.mjs` (`renderVersion`), which the server also calls when it renders without a turn.
- `cut_out({asset})` (and every face-pack cut-out): the image is turned upright, the background-removal model gives only the
  transparency, and the colour is the photo's own at full depth. The library's own PNG is a 256-colour palette image whose
  dithering turned skin and teeth into speckles, so it is never used for colour. It removes the background of `assets/<asset>` and writes
  `assets/<stem>-cutout.png` (never overwriting: `-2`, `-3` ... when the name is taken, so `face.jpg`
  and `face.png` do not collide). It returns `{name, width, height, from}`; the server registers it
  from that result. Images over 100 megapixels are refused.

The server learns about a render from the `tool_result` that follows an `mcp__imago__render`
`tool_use` in the stream. It reads the highest `renders/v<n>.png`, records the version (with its
`checks`) in `project.json`, sets `current` and emits `render.done`.

The MCP process gets extra environment from `mcpConfig` for the feed: `IMAGO_DATA_DIR` (where the
neighbours are), `IMAGO_PROJECT_ID`, `IMAGO_PRESET` (only `thumbnail` is judged), `IMAGO_FORMAT`
(`video`, `shorts` or `podcast`: the brief's `format`, else the canvas shape), `IMAGO_BRIEF_TITLE` and
`IMAGO_CONCEPT_SET` (the project's `conceptSet.id`, empty when it has none).

## HTTP API

Everything is JSON unless stated otherwise. Errors are `{error: {code, message}}` with a fitting
status.

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /api/health` | | `{ok: true, version}` |
| `GET /api/capabilities` | | `{claude: {state: "ready"\|"missing"\|"signed-out", reason, fix}, renderer: {state: "ready"\|"missing", reason, fix}, model, effort}` |
| `GET /api/presets` | | `[{id, label, description, defaultSize, sizes, briefFields, chips: [string]}]` |
| `GET /api/fonts` | | `fonts.json` content |
| `GET /api/projects` | query: `query` (words, all must appear in the title or brief), `preset`, `series` (an id, or `none`), `starred=1`, `sort` (`edited` default, `newest`, `oldest`, `title`), `offset`, `limit` (default 40, at most 200) | `{items, total}`; an item is the compact card `{id, title, preset, size, series, starred, createdAt, updatedAt, versionCount, current, thumbnail: url\|null}` (no conversation) |
| `POST /api/projects` | `{preset, title?, size?, brief, series?, kit?, brand?}` | `project` (does not start a turn); `series` must exist (400 `BAD_SERIES`); `kit` is a kit id from `GET /api/kits` (thumbnails only: 400 `BAD_KIT`, 404 `NO_SUCH_KIT`), and fills the blank brief fields |
| `GET /api/projects/:id` | | `project` |
| `PATCH /api/projects/:id` | `{title?, starred?, series?: id\|null}` | `project`; does not change `updatedAt` (a rename is not an edit of the design); 400 `BAD_TITLE`, `BAD_STARRED`, `BAD_SERIES` |
| `DELETE /api/projects/:id` | | `{ok: true}`; permanent (the UI uses the bulk delete below, which can be undone) |
| `POST /api/projects/:id/duplicate` | | 201 `project`: the folder copied with versions, renders and assets under a new id, title "<title> (copy)", no `sessionId`, `briefSent` false, not starred. 409 `TURN_RUNNING` while a turn runs |
| `POST /api/projects/:id/new-in-style` | `{title?, brief?}` | 201 `project`: same preset and size (a thumbnail keeps its format), in the source's series (a series named after the source is created, with the source as its `styleProjectId`, when it has none), with `assets/style-reference.png` (the source's current render, registered as an asset of kind `reference`) and `reference/style-reference.html` (its design.html). Content brief fields come from `brief`, the others (channel colours) carry over. 409 `NO_RENDER` when the source has no render, 409 `TURN_RUNNING` while it runs |
| `POST /api/projects/bulk` | `{action: "delete"\|"restore"\|"star"\|"unstar"\|"series", ids (1 to 500), series?: id\|null}` | `{ok: true, changed: [id], missing: [id]}`. `delete` aborts a running turn, waits, and moves the folder to `projects/.trash/` (undoable with `restore`; purged when older than seven days, at start-up). `series` with `null` takes projects out of any series |
| `GET /api/projects/export.zip?ids=a,b` | | `application/zip` (store-only, no dependency): each project's current render as `<title>-<id>-v<n>.png`; projects without a render are skipped, 404 `NO_RENDERS` when none has one |
| `GET /api/series` | | `[{id, name, createdAt, styleProjectId?, count}]` |
| `POST /api/series` | `{name, styleProjectId?}` | 201 series; 409 `EXISTS` for a name already used (case-insensitive) |
| `PATCH /api/series/:id` | `{name?, styleProjectId?: id\|null}` | series |
| `DELETE /api/series/:id` | | `{ok: true}`; its projects leave the series and keep their files |
| `POST /api/projects/:id/assets` | raw bytes; `x-filename` header (required); PNG, JPEG or WebP; at most 40 MB and 100 megapixels (413 `IMAGE_TOO_LARGE`); `Content-Type` only `application/octet-stream` or `image/png\|jpeg\|webp` | `{name, width, height}`; names are claimed atomically (`wx`), `-2`, `-3` ... on a clash |
| `POST /api/projects/:id/assets/:name/cutout` | | `{name, width, height}` |
| `POST /api/projects/:id/messages` | `{text}` | 202 `{ok: true}`; 409 if a turn is running |
| `POST /api/projects/:id/cancel` | | `{ok: true}` |
| `POST /api/projects/:id/restore` | `{version}` | `project` (copies `versions/v<n>.html` to `design.html`, sets `current`); 404 when the version or its file is missing; 409 while a turn runs |
| `POST /api/projects/:id/export` | `{format: "png"\|"jpg"\|"webp", scale: 1\|1.5\|2\|3 (longest output edge at most 8192)}` | `{name, url, width, height, bytes}` |
| `POST /api/projects/:id/platform-export` | `{platforms?: ["youtube-shorts"\|"instagram-reels"\|"tiktok"]}` (default: the brief's platforms, else all three) | `{name, url, bytes, files: [{platform, name, width, height, bytes, quality, overBudget}]}`: one platform is a JPG, several a zip; 400 `NOT_SHORTS`, 409 `NO_RENDERS`, `TURN_RUNNING`; see Platform covers |
| `GET /api/faces`, `POST /api/faces`, `PATCH|DELETE /api/faces/:id`, `POST /api/faces/:id/restore`, `POST /api/faces/:id/recut`, `POST /api/faces/reclassify`, `GET|PUT /api/faces/settings` | | the face pack; see "Face pack" |
| `GET /api/brands`, `POST /api/brands`, `GET|PATCH|DELETE /api/brands/:id` | `{name, description?, colours, fonts, devices?, guidance?, isDefault?}` (PATCH: any of them) | `{items, defaultId}`; a brand view (assets carry a `url`); see "Brands" |
| `POST /api/brands/:id/assets?kind=logo\|mascot\|other&note=` | raw image, `x-filename`, as for projects | 201 `{name, kind, note, width, height, url}` |
| `PATCH|DELETE /api/brands/:id/assets/:name` | `{kind?, note?}` | the asset; `{ok: true}` |
| `GET /api/kits` | | `{items: [kit summary], rejected: [{name, reason}]}`; see Fabula kits |
| `POST /api/concept-sets` | `{title?, brief, kit?, brand?, count?: 2-4 (default 3)}` or `{titles: [2 or 3], brief, ...}` | 201 set view (state `draft`) and its N projects; 400 `BAD_COUNT`, `NEEDS_TITLE`, `BAD_TITLES`; see "Title A/B sets" |
| `POST /api/concept-sets/:id/assets` | raw image, `x-filename`, as for projects | `{name, width, height}`: the photo goes into every concept project and the planner's folder; only while `draft` (409 `NOT_DRAFT`) |
| `POST /api/concept-sets/:id/start` | | 202 set view; plans and designs in the background; 409 `ALREADY_STARTED` |
| `GET /api/concept-sets/:id` | | the set view |
| `GET /api/concept-sets/:id/events` | | SSE, see Concept sets |
| `POST /api/concept-sets/:id/cancel` | | set view; aborts the planner and every running design turn |
| `POST /api/concept-sets/:id/another` | | 202 set view; 409 `SET_BUSY`, `TOO_MANY` (eight archetypes, so at most eight concepts), `NOT_SUPPORTED` (title tests and face sets) |
| `POST /api/concept-sets/:id/test-compare` | `{projects?: [project id]}` | `{name, url, bytes, files}`; see Test & Compare |
| `GET /api/projects/:id/face-status` | | `{faces: [{id, state, assets, reason?}], stale}`; see "Faces inside a project" |
| `POST /api/projects/:id/refresh-faces` | | `{project, version, refreshed, skipped}`: the pack's faces copied in again and a new version rendered with no turn; 409 `TURN_RUNNING`, `NO_FACES`, `NOTHING_REFRESHED` |
| `POST /api/projects/:id/face-variants` | `{faces?: [id], count?: 1-6}` | 201 set view (`kind: "faces"`): the design once per face, one face-swap turn each |
| `POST /api/concept-sets/:id/pick` | `{project}` | set view; stars that concept and records `picked` |
| `POST /api/projects/:id/quick-export` | | `{name, url, width, height, bytes, overBudget}`: the 3x JPG saved in `exports/` under the title |
| `GET /api/projects/:id/exports`, `DELETE /api/projects/:id/exports/:name` | | the exports list; removal |
| `GET /api/faces/:id/projects`, `POST /api/faces/:id/refresh-projects` | `{all?}` | where a pack face is used and which copies are stale; refresh that face in them |
| `GET /api/projects/:id/events` | | SSE, below |

### Series and the style reference

`<IMAGO_DATA_DIR>/series.json` is `[{id, name, createdAt, styleProjectId?}]` and `project.series` is a
series id. A series keeps a channel's thumbnails looking alike. When a project in a series has
`reference/style-reference.html`, the runner appends `presets/series.md` (the "Series style"
section: match the reference's layout system, type, colours, badges and treatment exactly, change
only the title and the imagery) to the system prompt. A project that joins a series whose
`styleProjectId` still has a render (by `PATCH`, bulk or `POST /api/projects` with `series`) gets the
same reference copied in. `reference/` is not one of the served folders, and Claude's `Read(./**)`
reaches it; it still cannot write there.

A duplicate has history but no session, so its first turn is built like a recovered session: the
brief, a recap of the last ten messages, and the note "design.html already holds the duplicated
design: Read it first and edit it rather than starting over", then the user's text.

### Who may call (origin rule)

The `Host` must be loopback. A request that is not `GET` or `HEAD` must come from this server's own
origin: `Origin`, when present, is exactly `http://127.0.0.1:<port>` or `http://localhost:<port>`
(the port the server is actually listening on) or one of `IMAGO_ALLOWED_ORIGINS`; otherwise 403
`FORBIDDEN_ORIGIN`. When `Sec-Fetch-Site` is present it must be `same-origin` or `none`. Requests
with no `Origin` (curl, tests) are allowed. A JSON body must be `Content-Type: application/json`
(415 `BAD_CONTENT_TYPE`); uploads keep their image or octet-stream type but must carry `x-filename`,
which forces a CORS preflight from any other origin.

### Files

The server also serves these files, with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`:

- `/projects/:id/design.html` and `/projects/:id/versions/v<n>.html`, with
  `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'`.
- `/projects/:id/assets/*`, `/projects/:id/renders/*` and `/projects/:id/exports/*` (never `reference/` or the trash): only
  `.png`, `.jpg`, `.jpeg` and `.webp` (404 for anything else, sidecar `.json` files included), each
  with `Content-Security-Policy: sandbox; default-src 'none'`. Only those extensions are registered
  into `project.assets`.
- `/projects/:id/exports/*.zip` (platform covers), `/concept-sets/:id/exports/*.zip` (Test & Compare): `application/zip`, `Content-Disposition: attachment`, the same `sandbox` CSP.
- `/faces/:id/original.<ext>`, `/faces/:id/cutout.png`, `/faces/:id/thumb.png` (the face pack; images only, never `face.json`), the same CSP.
- `/brands/:id/assets/<file>`: only the image files that brand declares, image extensions only, the same CSP; 404 for anything else (a stray file, `brands.json`). `/brands` alone is the UI page.
- `/kits/:kitId/frames/<file>` and `/kits/:kitId/pictures/<file>`: only the image files that kit's `kit.json` declares, image extensions only, the same CSP; 404 for anything else (kit.json included).
- `/fonts/*` (with `Access-Control-Allow-Origin: *`, because the UI previews a design in a sandboxed,
  opaque-origin iframe whose font loads are cross-origin) and `web/dist`, with an SPA fallback to
  `index.html` for paths that are not `/api`.

Every path segment is checked to be a safe leaf name, and traversal is refused.

### SSE `/api/projects/:id/events`

Each message is `event: <name>` plus `data: <json>`. A new subscriber first gets `snapshot`
(`{project}`).

| Event | Data |
| --- | --- |
| `snapshot` | `{project}` |
| `run.started` | `{at}` |
| `assistant.text` | `{text}` (a complete text block from the assistant) |
| `tool.use` | `{name, summary}` (for example "Writing design.html" or "Rendering") |
| `tool.done` | `{name, ok}`: the `tool_result` for an earlier `tool.use` arrived (matched by tool-use id; `ok` is false for an error). The UI refreshes the live draft after a `Write` or `Edit` is done |
| `render.done` | `{version, url, warnings, checks, feedUrl}`: `checks` is `[]` and `feedUrl` null for a photo or graphic, or when the mock-up failed |
| `run.finished` | `{ok: true, costUsd, durationMs}`. `costUsd` is Claude Code's `total_cost_usd`: an API-price estimate, not a charge on a subscription. The UI labels it that way |
| `run.error` | `{code, message}` (`CLAUDE_MISSING`, `CLAUDE_SIGNED_OUT`, `TIMEOUT`, `CANCELLED`, `EXITED`) |
| `project` | `{project}` (after any change to project.json) |

A heartbeat comment is sent every 15 s.

## UI

The UI follows Instrumenta brand v2 (`Instrumenta/brand/ALIGNMENT.md`). The accent is Imago teal.
It uses Fraunces for names and headings, Commissioner for the interface, and Spline Sans Mono for
sizes, versions and costs. It has dark and light themes, honours reduced motion and shows a
visible focus.

The workspace toolbar has **Try other faces** (thumbnails with a pack face) and the Export popover leads with a one-click export; a bar offers **Refresh faces** when the pack's copy is newer, and the project's exports are listed under the preview (see "Faces inside a project" and "Exports").

Routes: `/` (start: the three presets and the latest eight projects, "View all"), `/library`, `/faces` (the face pack), `/brands` (see Brands),
`/new/<preset>` (`?style=<project id>` for "New in this style"), `/p/<id>`, `/c/<set id>` (the compare screen). The library searches by
title and brief, filters by preset, series and starred, sorts four ways, loads 40 at a time, and has a
"⋯" menu per card (also in the workspace header: Open, Rename, Star, Duplicate, New in this style,
Move to series, Delete with a six-second Undo), multi-select (checkboxes, shift-click range, select
all shown) and a bulk bar (Delete, Star, Move to series, Export as a zip). The thumbnail start form
has an optional Series picker (none, existing, new).

Thumbnail projects have a Design / In the feed switch above the preview. The Feed view
(`screens/FeedView.tsx`) wraps the exported `FeedPreview` (`web/src/feed/FeedPreview.tsx`; props
`{src, format, title, channel?, neighbours, theme, surface}`, scaled to fit its container) with a
switch for the surfaces of the format, dark and light (the full-screen players are always dark), a
note on whether the neighbours are the owner's own designs, and the current version's checks as a
plain list. `?mock=1` shows it with canned checks and stand-in neighbours.

Every asset is copied into `web/public/brand/`; nothing is fetched from a CDN. The content fonts in
`fonts/` are for designs, never for the chrome.

## Feed mock-up and checks

Every thumbnail render is judged in context (the plan is `Instrumenta/docs/suite/thumbnail-uplift.md`,
"Feed mock-up and checks"). It costs about 0.7 s per render, measured on this machine: a 1280×720
render through the MCP took 0.58 s before and 1.25 s after (decoys or eight real neighbours alike);
the budget was 1.5 s.

### How it is made

`render.cjs` renders the design, then (`--measure`) walks the page for text boxes and computed styles
(`dom-measure.cjs`), captures it a second time with every glyph made invisible to read what each text
block sits on, and takes pixel statistics of a 320 px-wide copy. With `--feed=<job.json>` it then
opens the staged feed page in a second window of the same process, under the same rules (the page
folder is the only readable one, no network, CSP without `script-src`) and saves the capture. The MCP
stages a temp folder (`imago-feed-*` in `os.tmpdir()`: the page, `thumb.png`, copies of the
neighbours, all brief strings HTML-escaped) and removes it afterwards. The mock-up is 1568 px wide
(so a vision model does not downscale it), dark and light side by side, with this design outlined in
teal. `server/feed-markup.mjs` and `server/feed.css` draw it and are also what the UI's `FeedPreview`
injects, so the two cannot drift.

**Neighbours.** The owner's other thumbnail projects of the same shape (16:9, 9:16 or 1:1 by the
brief's format or the canvas), newest `updatedAt` first, at most eight, each its current render.
Excluded: this project, every project whose `conceptSet.id` equals this one's, projects without a render on disk. Fewer than six are
padded with neutral stand-ins (gradient and disc SVGs). `feed.distinct` compares against the real ones
when there are any, else against the stand-ins, and its message says which.

### Surfaces, sizes and where they came from (accessed 2026-10-13)

YouTube publishes no display sizes, and the third-party guides disagree, so these are the values
chosen and the evidence behind them. Real-size drawing, in CSS px:

| Format | Surface | Drawn as |
| --- | --- | --- |
| 16:9 | Home grid, desktop | two cards 356 wide, 12 px radius, avatar, title (2 lines max), channel, views, duration badge |
| 16:9 | Search results, desktop | 360 × 202 thumbnail beside title, views, channel, snippet |
| 16:9 | Watch page sidebar | 168 × 94 thumbnail, 8 px radius, title beside it |
| 16:9 | Mobile home | 360 wide, full width, no radius |
| 9:16 | Shorts shelf | tiles 168 × 298 |
| 9:16 | Shorts, Reels, TikTok full screen | 390 × 780 phone, cover-fit, with top bar, right action rail, bottom caption block and a 52 px nav bar |
| 9:16 | Instagram and TikTok profile grids | three columns, tiles about 120 × 160 (3:4, centre crop), TikTok view count bottom-left |
| 1:1 | Podcast shelf | square cards 168 |
| 1:1 | Mobile podcast list | 96 px square |
| 1:1 | Square in a 16:9 slot | pillarboxed in black |

- YouTube Help, "Add video thumbnails" (support.google.com/youtube/answer/72431, fetched): 3840×2160 for
  videos (16:9), 2160×3840 for Shorts (9:16), upload limits 2 MB on mobile and 50 MB on desktop;
  podcast playlists take a thumbnail "with an aspect ratio of 1:1 instead of 16:9" (10 MB mobile).
  That is the only official source found, and it gives no on-screen sizes.
- Sidebar about 168 × 94 px: touhfa.art (youtube-thumbnail-size-guide) and creaticalc.com (youtube
  thumbnail mobile readability). Search results: 246 × 138, 360 × 202 or 240 to 360 wide by different
  guides; 360 chosen. Home grid: 320 × 180 up to 480 × 270 depending on the window; 356 chosen so two
  fit the 760 px panel. Mobile: 116 to 168 wide in one guide, about 350 CSS px in another; a full-width
  360 phone chosen. The duration badge sits bottom-right on all of them (every guide says to keep that
  corner clear). The title, channel and badge typography (16/22 medium, 12/18 grey, badge 12 px on
  `rgba(0,0,0,.8)` with a 4 px inset) is from the live interface as remembered, not from a source.
- 3:4 profile-grid crop: hopperhq.com ("Instagram Reel Size in 2026", "Instagram's vertical grid"):
  a 1080×1920 cover loses 240 px top and bottom, leaving 1080×1440 (y 240 to 1680). The task brief
  and the plan give the same crop for the TikTok grid. Used as 12.5% off the top and bottom.
- Overlay zones (no platform publishes them; the sources disagree by up to 2×): houseofmarketers.com
  (TikTok: 131 px top, 367 px bottom, 120 px sides on 1080×1920), poster.ly safe-zone checker
  (TikTok: 250 px bottom, 100 px right, 100 px top; Shorts: 180 px bottom, 80 px right, 100 px top),
  clipspeed.ai (Shorts: about 15% top and bottom, 140 px right), remotion.dev social-safe-zones
  (Instagram: action rail x 900 to 1025, captions from y 1700), abyssale and timetopost checkers
  (Reels: 250 to 340 px top and bottom, 120 px rail from mid-height). Chosen, as fractions of the
  canvas, and drawn that way: action rail right 15% from 42% to 80% down; caption block bottom 22%
  (left 80% of the width); top bar top 8%.
- 1:1: the only official fact is that podcast playlists want 1:1. Where a square thumbnail is used as
  an ordinary episode thumbnail, one third-party guide (touhfa.art, podcast thumbnail design guide)
  says YouTube pillarboxes it in a 16:9 frame with black bars. Unverified and shown as such in the
  label. Mobile podcast list sizes are a judgement.

### Checks

`{id, level: "ok"|"warn"|"info", value, message}`, in this order, never blocking. `layout.badge`
appears for 16:9 only and `layout.safe` for 9:16 only. Thresholds live in `LIMITS` in
`server/checks.mjs`. "Visible" text means rendered text nodes that are not `display: none`,
`visibility: hidden`, near-transparent or mostly off the canvas.

| id | Rule |
| --- | --- |
| `text.words` | Visible words; warn above 5 (16:9, 1:1) or 4 (9:16) |
| `text.repeatsTitle` | Share of the visible words (filler words ignored) that are also in the brief's title; warn at 0.6 or more with at least two content words |
| `text.smallest` | Smallest cap height (measured with the real font, "H") times the smallest surface's width over the canvas width: 168 px (16:9 sidebar), 120 (9:16 grid tile), 96 (1:1 list). Warn under 7 px, which is about a 10 px sans, the least that reads on a phone; the message says what font size would pass |
| `text.contrast` | WCAG ratio of the weakest block's colour (alpha applied) against the median luminance of what is behind it. Warn under 3:1 (thumbnail text is large text); 2:1 for text with a stroke or shadow. Gradient-filled text is skipped |
| `layout.badge` | Warn when text overlaps the bottom-right 15% × 13% by 10% of its area, or a cut-out covers 30% of that zone |
| `layout.safe` | Warn for text outside 12.5% to 87.5% of the height, in the rail zone, or in the caption zone; or a cut-out whose top is above the crop |
| `subject.size` | Tallest `<img>` whose `src` contains `cutout` (the name `cut_out` writes) or `face-<8 hex>` (a pack face), as a share of the canvas height. Warn under 0.5 (16:9, 1:1) or 0.4 (9:16). Faces are not detected: a face is a subject only if it was cut out |
| `image.contrast` | Info: p95 minus p5 of luma at 320 px; the band to aim for is 0.55 to 0.95 |
| `image.colourfulness` | Info: Hasler and Susstrunk M at 320 px; under 15 muted, 33 or more vivid |
| `feed.distinct` | Info: mean CIE76 colour difference between this render's mean colour and each neighbour's; under 18 reads as blending in |

Known limits: `text.smallest` ignores CSS transforms; contrast is against a median, so text on a very
busy picture can read better or worse than the number; transparent areas are measured over white.

## Fake claude (tests)

`tests/fixtures/fake-claude.mjs` reads its arguments and stdin like `claude -p`, and reads the MCP
config from `--mcp-config`. It then:

1. writes a valid `design.html` into its working directory (the project);
2. spawns the render MCP over stdio and calls `render`;
3. emits stream-json lines: `system/init` with a `session_id`, an assistant `text`, a `tool_use`
   for `mcp__imago__render`, the matching `tool_result`, and a `result` with `total_cost_usd: 0`.

`FAKE_CLAUDE_MODE=signed-out|fail|slow` exercises the error paths; a turn started without the imago MCP server is a planning turn and writes `concepts.json` (`FAKE_CLAUDE_PLANNER=invalid|missing|duplicate` changes what); a turn started without the imago MCP server whose system prompt says "You label photos" is a face classification and writes `labels.json` for every image in `images/` (`FAKE_CLAUDE_FACES=invalid|partial|missing|badjson`), and a planner finding `faces/faces.json` sets `face` on each concept (`FAKE_CLAUDE_PLANNER=badface` names one the pack lacks); `FAKE_CLAUDE_FAIL_WHEN=<regex>` kills a turn whose prompt matches; `FAKE_CLAUDE_DELAY_MS` holds a design turn open and `FAKE_CLAUDE_TRACE=<file>` logs when turns start and end (the parallelism tests); `early-fail` dies before `init`, and `resume-fail` answers "No conversation found" to any `--resume`. A planner whose system prompt has "Title A/B test" reads the titles from the first message and echoes each in its concept with its own words (`FAKE_CLAUDE_PLANNER=repeat` makes concept 1 repeat its title, `notitle` drops the echo). A design turn whose first message says "Replace assets/<old> with assets/<new>" (a face swap) shows the new image in its design. The fake reads the system prompt file while the turn runs and records it as `systemPrompt` in `fake-claude-call.json`.

## Take it further

Normal turns run on `IMAGO_MODEL` at `IMAGO_EFFORT`. When the owner is not happy they press "Take it
further": the next turn runs on a stronger model with more freedom and more tools.

- `POST /api/projects/:id/messages` takes `{text, mode?: "standard"|"further", model?: "opus"|"fable"}`.
  `model` is a key of `IMAGO_FURTHER_MODELS` (400 `BAD_MODEL` otherwise, 400 `BAD_MODE` for a bad
  mode). `text` may be empty only for `further`; the server then uses "Take this design further:
  rethink it with full creative freedom and make it exceptional, keeping the brief's content and
  intent." The turn still `--resume`s the project's session, so the stronger model sees the history.
- Further turns run with `--model <furtherModels[model]> --effort $IMAGO_FURTHER_EFFORT`, the
  timeout doubled, `--tools "Read,Write,Edit,Glob,WebSearch"`, `--allowedTools` plus
  `WebSearch,mcp__imago__search_images,mcp__imago__fetch_image` (no `WebFetch`),
  `--disallowedTools` the standard list minus `WebSearch`, and `presets/further.md` appended to the
  system prompt. The render cap is 4 in standard turns and 8 in further turns (a prompt rule).
- Messages (user and assistant) carry `mode` and `model` (the model id that ran the turn). SSE
  `run.started` is `{at, mode, model}`.
- `search_images({query, count?})` searches Openverse (`license_type=commercial,modification`) and
  returns `[{id, title, url, thumbnail, width, height, creator, license, license_url, source}]`.
- `fetch_image({url, credit?, license?, license_url?, source?})` downloads an https image
  (redirects only to https, every hop resolved and refused if loopback, private or link-local; port
  443 only; 25 MB cap) into `assets/`, checks it is a real PNG, JPEG or WebP (GIF, AVIF and TIFF are
  converted to PNG with sharp when installed, anything else is refused), writes
  `assets/<name>.json` (`{url, credit, license, licenseUrl, source, fetchedAt}`) and returns
  `{name, width, height}`. Implemented in `server/stock.mjs`. Images over 100 megapixels are refused,
  names are claimed with `wx`, and `license_url` (in the sidecar, in `search_images` results and when
  read back) is kept only if it is an http(s) URL.
- After a `fetch_image`, `cut_out` or `use_face` result the server syncs `assets/` into project.json
  (`syncAssets`). A file with a sidecar becomes `kind: "stock"` with `credit`, `license`,
  `licenseUrl`, `source` and `url`; a cut-out of a credited image inherits the credit.
- `POST /api/projects/:id/export` also returns `credits`: `[{name, credit, license, licenseUrl, source}]`
  for the credited assets that `design.html` references.
- UI: a "Take it further" button with an Opus 5.5 / Fable 5.1 choice (remembered in localStorage)
  beside the refine chips, a model badge on messages from a further turn, and an "Image credits"
  disclosure under the preview.
- `FAKE_CLAUDE_ARGS_OUT=<file>` makes the fake claude append `{argv, stdin, systemPrompt}` per call;
  `FAKE_CLAUDE_STOCK=1` makes it play a `fetch_image` call.

`tests/fixtures/kit.mjs` writes a schema-v1 kit (small real JPEG and PNG images) for the kit and concept tests, which use temp roots only (`startApp` sets `fabulaRoots: []` unless a test passes roots, and takes injected `deps.cutOut`).

`tests/fixtures/seed-library.mjs <dataDir> [count]` fills a data directory with fake projects and three series, for looking at the library.
