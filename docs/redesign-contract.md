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
│   ├── series.mjs      series.json (series metadata)
│   ├── library.mjs     list query (filter, sort, page) and the style-reference copy
│   ├── zip.mjs         a store-only zip writer for the library's Export
│   └── presets/        design-rules.md, thumbnail.md, photo.md, graphic.md, series.md, reference/
├── render/render.cjs   headless Electron: design.html -> png|jpg|webp
├── fonts/              content fonts for designs (TTF) + fonts.css + fonts.json
├── web/                Vite + React + TS UI -> web/dist
└── tests/              node --test; never spends subscription usage
```

Scripts: `npm start` (server), `npm run dev` (server and Vite together, Vite proxying `/api`,
`/projects`, `/fonts` to the server), `npm run build` (UI), `npm test`.

## Runtime

- `PORT` and `HOST` come from the environment. The launcher sets `HOST=127.0.0.1` and a port; the
  default is `127.0.0.1:49321`. Never listen on anything but loopback.
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
versions/v<n>.html      snapshot taken at each render
renders/v<n>.png        the render of that snapshot, at scale 1
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
  "versions": [{ "n": 1, "at": "ISO", "warnings": [] }],
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
| `thumbnail` | by `brief.format`: `video` 16:9 1280×720 (default), `shorts` 9:16 720×1280, `podcast` 1:1 1280×1280 | `title` (the video's title or topic), `channelColours?`, `notes?`, `format?` |
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
  `[{type:"image", data, mimeType:"image/png"}, {type:"text", text: JSON {version, warnings}}]`.
  On validation errors it returns `isError: true` with the list.
- `cut_out({asset})`: removes the background of `assets/<asset>` and writes
  `assets/<stem>-cutout.png` (never overwriting: `-2`, `-3` ... when the name is taken, so `face.jpg`
  and `face.png` do not collide). It returns `{name, width, height, from}`; the server registers it
  from that result. Images over 100 megapixels are refused.

The server learns about a render from the `tool_result` that follows an `mcp__imago__render`
`tool_use` in the stream. It reads the highest `renders/v<n>.png`, records the version in
`project.json`, sets `current` and emits `render.done`.

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
| `render.done` | `{version, url, warnings}` |
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

Every asset is copied into `web/public/brand/`; nothing is fetched from a CDN. The content fonts in
`fonts/` are for designs, never for the chrome.

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
