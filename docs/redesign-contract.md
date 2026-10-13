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
│   └── presets/        design-rules.md, thumbnail.md, photo.md, graphic.md, series.md, further.md, planner.md, concept.md, craft/<preset>/
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
- `IMAGO_DATA_DIR` holds the projects (`projects/`), `series.json` and the trash (`projects/.trash/`), `~/.local/share/imago` by default.
- `IMAGO_CLAUDE_BIN` is `claude` by default. Tests point it at `tests/fixtures/fake-claude.mjs`.
- `IMAGO_MODEL` defaults to `claude-sonnet-5-5`. `IMAGO_EFFORT` defaults to `medium`.
- `IMAGO_FURTHER_MODELS` defaults to `opus=claude-opus-5-5,fable=claude-fable-5-1`: the models a
  "Take it further" turn can use. `IMAGO_FURTHER_EFFORT` defaults to `high`.
- `IMAGO_TURN_TIMEOUT_MS` defaults to 600000.
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
reference/              style-reference.html: the series reference design (see Library); never served
reference/craft/        the preset's craft files, copied in by the server on every turn (see Thumbnail craft); never served
versions/v<n>.html      snapshot taken at each render
renders/v<n>.png        the render of that snapshot, at scale 1
renders/v<n>-feed.png   thumbnails only: that render in a feed mock-up (see "Feed mock-up and checks")
exports/                files made by Export
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
  "assets": [{ "name": "face.png", "kind": "upload|cutout|stock", "width": 0, "height": 0, "from": null }],
  "messages": [{ "role": "user|assistant", "text": "", "at": "ISO", "version": null, "mode": "standard|further", "model": "claude-..." }],
  "versions": [{ "n": 1, "at": "ISO", "warnings": [], "checks": [{ "id": "text.words", "level": "ok", "value": 3, "message": "3 words." }] }],
  "current": 1,
  "running": false,
  "series": null,
  "starred": false
}
```

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
| `thumbnail` | by `brief.format`: `video` 16:9 1280×720 (default), `shorts` 9:16 720×1280, `podcast` 1:1 1280×1280 | `title` (the video's title or topic), `channelColours?`, `notes?`, `format?`; the brief may also carry `platforms?` (see Thumbnail craft) |
| `photo` | the first uploaded photo's own size, or an aspect chosen from `original, 1:1, 4:5, 3:4, 2:3, 9:16, 4:3, 3:2, 16:9, 21:9` (long edge kept at most 2160) | `instruction` |
| `graphic` | chosen from the grouped catalogue below, or custom (64–4096 each side) | `description` |

**Thumbnails.** YouTube's custom thumbnail spec: 3840×2160 for videos, 2160×3840 for Shorts, 1:1
for podcasts; JPG or PNG; 2 MB limit from the mobile app, 50 MB from desktop. The design canvas
stays at the sizes above (type and layout are tuned for them) and the full resolution comes from
export at 3×. `POST /api/projects` takes the size from `brief.format`; an unknown format is 400
`BAD_FORMAT`, and a `size` in the body is ignored for thumbnails (not even validated). The export menu defaults to 3×
("4K, YouTube's recommended size") and JPG for thumbnails, 1.5× stays "1080p", and after an export it
shows the file size, warning when it is over 2 MB (too big for the mobile app, fine on desktop;
choose JPG if it was PNG). JPG quality is 0.92 (`render.cjs`).

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
  `thumbnail.md`. A planning turn needs Read and Glob, `Write(./concepts.json)` and no `render` or
  `cut_out`, and may Read the kit's files in `assets/` (named in its first message, with the contact
  sheet when there is one) and `reference/craft/`. It writes `{"concepts": [...]}` in the shape of the
  plan (`archetype`, `label`, `idea`, `text`, `frame?`, `pictures?`, `why`). The wiring validates the file
  (distinct archetypes in `THUMBNAIL_ARCHETYPES`, `text` of at most 4 words, `frame` and `pictures` paths
  that exist) and falls back when it fails; the prompt asks for exactly that.
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
`stretch` range in `fonts.json` and a `font-stretch` range in `fonts.css`. Only OFL or Apache-2.0
faces may be added.

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
  is a warning, not an error.
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
- `cut_out({asset})`: removes the background of `assets/<asset>` and writes
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
| `POST /api/projects` | `{preset, title?, size?, brief, series?}` | `project` (does not start a turn); `series` must exist (400 `BAD_SERIES`) |
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

Routes: `/` (start: the three presets and the latest eight projects, "View all"), `/library`,
`/new/<preset>` (`?style=<project id>` for "New in this style"), `/p/<id>`. The library searches by
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
Excluded: this project, every project whose `conceptSet.id` equals this one's (a field piece D adds;
absent today, so nothing is excluded by it yet), projects without a render on disk. Fewer than six are
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
| `subject.size` | Tallest `<img>` whose `src` contains `cutout` (the name `cut_out` writes), as a share of the canvas height. Warn under 0.5 (16:9, 1:1) or 0.4 (9:16). Faces are not detected: a face is a subject only if it was cut out |
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

`FAKE_CLAUDE_MODE=signed-out|fail|slow` exercises the error paths; `early-fail` dies before `init`, and `resume-fail` answers "No conversation found" to any `--resume`. The fake reads the system prompt file while the turn runs and records it as `systemPrompt` in `fake-claude-call.json`.

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
- After a `fetch_image` or `cut_out` result the server syncs `assets/` into project.json
  (`syncAssets`). A file with a sidecar becomes `kind: "stock"` with `credit`, `license`,
  `licenseUrl`, `source` and `url`; a cut-out of a credited image inherits the credit.
- `POST /api/projects/:id/export` also returns `credits`: `[{name, credit, license, licenseUrl, source}]`
  for the credited assets that `design.html` references.
- UI: a "Take it further" button with an Opus 5.5 / Fable 5.1 choice (remembered in localStorage)
  beside the refine chips, a model badge on messages from a further turn, and an "Image credits"
  disclosure under the preview.
- `FAKE_CLAUDE_ARGS_OUT=<file>` makes the fake claude append `{argv, stdin, systemPrompt}` per call;
  `FAKE_CLAUDE_STOCK=1` makes it play a `fetch_image` call.

`tests/fixtures/seed-library.mjs <dataDir> [count]` fills a data directory with fake projects and three series, for looking at the library.
