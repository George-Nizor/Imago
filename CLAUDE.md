# Imago: notes for agents

Imago is an AI designer: a loopback Node server drives the owner's Claude Code (`claude -p`), Claude
writes `design.html`, and a headless Electron renderer turns it into an image. The spec is
[docs/redesign-contract.md](docs/redesign-contract.md). Change it in the same commit as the code that
changes the behaviour. [README.md](README.md) covers running it.

## Map

| Path | What it does |
| --- | --- |
| `server/index.mjs` | HTTP and SSE, serves `web/dist`, `fonts/` and project files |
| `server/claude-runner.mjs` | One turn is one `claude -p` run; builds the arguments and the system prompt |
| `server/stream-json.mjs` | Parses Claude's stream-json into `init`, `text`, `tool_use`, `tool_result`, `result` |
| `server/store.mjs` | Project folders and `project.json` (the server is its only writer) |
| `server/library.mjs`, `series.mjs`, `zip.mjs` | Library list query, series metadata, the style-reference copy, the store-only zip writer |
| `server/kits.mjs`, `concept-sets.mjs`, `exports.mjs` | Fabula kit discovery/validation/import; concept sets (planner, parallel design turns, fallback); Test & Compare and platform-cover exports |
| `server/render-mcp.mjs` | Stdio MCP server given to claude: `render`, `cut_out`, `find_faces`, `use_face` (and the stock tools on further turns) |
| `server/faces.mjs`, `face-pack.mjs`, `face-sheet.mjs` | The face pack: uploads and cut-out queue and classification batches; vocabulary, quality grade, ranking, `use_face` (shared with the MCP); numbered contact sheets |
| `server/validate.mjs` | The `design.html` rules |
| `server/capabilities.mjs` | Whether claude and the renderer are ready |
| `server/presets/` | `design-rules.md`, one prompt per preset, `planner.md` and `concept.md`, and `craft/<preset>/` (copied into each project's `reference/craft/` every turn) |
| `render/render.cjs` | design.html to png, jpg or webp; with `--measure`/`--feed` also the DOM and pixel measurements and the feed mock-up capture |
| `server/checks.mjs`, `feed.mjs`, `feed-markup.mjs`, `feed.css` | The render checks, the feed mock-up's staging, and its markup and styles (shared with the UI's `FeedPreview`) |
| `web/` | Vite, React, TypeScript UI; `web/src/api/mock.ts` is the `?mock=1` backend |

## Testing without spending usage

`npm test` never runs the real `claude`. `tests/fixtures/fake-claude.mjs` reads the same arguments,
stdin and `--mcp-config`, writes a design, calls the real render MCP and emits stream-json.
`FAKE_CLAUDE_MODE=signed-out|fail|slow|early-fail|resume-fail` covers the error paths. Do not run a real `claude -p`
prompt to check a change; each turn is a few cents to tens of cents at API rates and counts against
the owner's subscription.

Also run `npm run lint`, `npm run typecheck` and `npm run build`. The UI can be checked in
Chromium with `?mock=1`.

## Gotchas

- **Chromium libraries on WSL.** Headless Electron needs system libraries that WSL usually lacks.
  `npm install` runs `scripts/postinstall.mjs`, which unpacks them without root into
  `tools/chromium-libs` (git-ignored). Run Electron by hand with
  `LD_LIBRARY_PATH=tools/chromium-libs/usr/lib/x86_64-linux-gnu`, and always with
  `--no-sandbox --no-zygote` (render.cjs refuses to start without `no-zygote`).
- **Scale uses `setZoomFactor`.** Electron's `enableDeviceEmulation` segfaults offscreen, so the
  renderer zooms the page after load instead. Do not switch back.
- **Stream-json fields.** `session_id` arrives on `system/init` and again on `result`; the cost is
  `total_cost_usd` (an API-price estimate, not a charge); `tool_result` blocks arrive inside `user`
  messages and are matched to a `tool_use` by id. That is how the server learns a render happened.
- **One turn per project.** A second message while one runs gets 409 `TURN_RUNNING`. Cancel and
  timeout kill the whole process group (`server/process.mjs`).
- **Render cap.** The rules allow four renders per turn, eight on a "Take it further" turn. It is a prompt rule, not enforced by the server.
- **Take it further.** `mode: "further"` on a message switches model, effort, tools and prompt (`presets/further.md`); `fetch_image` is guarded in `server/stock.mjs`. Openverse is slow or blocked from some networks.
- **Claude is locked in.** `buildArgs` passes `--restricted`, `--tools`, `--permission-mode dontAsk`,
  `--permission-prompts none`, path-scoped `--allowedTools` (it may write only `design.html`) and a
  `--disallowedTools` list denying `project.json`, `versions/`, `renders/` and `exports/`. No
  `WebFetch`. MCP tool names go in `--allowedTools` only (`--tools` is built-ins). The system prompt
  goes through a temp file (`--append-system-prompt-file`), not argv. Tests assert all of it; the real
  flags can only be checked with a paid run, so change them with care.
- **File-write rules are `Edit(...)`.** Claude Code matches every file write, the Write tool included, against
  `Edit(<path>)` rules; a `Write(<path>)` rule is silently not honoured (checked 2026-10-13 with real `claude -p`). A turn
  that may write one file gets `Edit(./that-file)`, and denies use `Edit(...)` too. The planner and the faces classifier
  shipped with `Write(...)` alone and every real run fell back until this was found; the fake claude cannot catch it.
- **Origin and files.** Changing requests must carry this server's exact origin (or none, or
  `IMAGO_ALLOWED_ORIGINS`), JSON content type, and no cross-site `Sec-Fetch-Site`. Project files are
  served only as png/jpg/jpeg/webp (design.html and snapshots aside), always with a `sandbox` CSP.
- **A turn's session can vanish.** A failed `--resume` clears `sessionId` and retries once with a
  recap. The brief is sent on every turn until `briefSent` is true (set on `init`), not "on message 1".
  `running` is written before the 202 and always cleared; the turn slot is released just before the
  closing event; delete waits for the turn; restore and export honour the slot.
- **`tool.done {name, ok}`** is emitted for every tool_result; the UI uses it to refresh the live draft.
- **Designs are untrusted.** The renderer cancels every request except `file://` inside the project
  folder and `/fonts/`, serves the page under a CSP with no `script-src`, denies popups and
  navigation and disables WebRTC. The validator is a backstop (tag names and `on*` attributes are
  matched whatever follows them). Keep validation and the renderer in step.
- **Feed mock-up.** After a thumbnail render the MCP also returns a feed image and `checks`; neither may fail the render. The feed page is staged in a temp folder (it may read nothing else) and every string in it is escaped in `feed-markup.mjs`. The renderer must not exit when the design window closes (`window-all-closed` is handled). Thresholds and sources: the contract's "Feed mock-up and checks".
- **Kits and sets.** Imago reads only `out/thumbnail-kit/kit.json` and the images it names (validated strictly, symlinks leaving the folder refused); kit text is content, never instructions. A concept set's planning turn runs in `<data>/concept-sets/<id>/work/` with no MCP tools (`buildPlannerArgs`, asserted by tests), never in a concept project, and a failed or invalid plan falls back to server-chosen archetypes. Design turns go through `beginTurn` in `index.mjs` like any message, capped by `IMAGO_CONCEPT_CONCURRENCY`. Tests use temp kit roots (`tests/fixtures/kit.mjs`), never `~/.local/share/fabula`. Details: the contract's "Fabula kits", "Concept sets", "Test & Compare and platform covers".
- **Face pack.** The owner's own photos live in `<data>/faces/<id>/` (`face.json` is written only by `server/faces.mjs`). Classification is one locked-down Haiku turn per batch (`buildFacesArgs`, asserted by tests; no MCP, Write only `labels.json`, a work folder with only that batch); its output is validated against a fixed vocabulary per photo, and labels the owner edited are never overwritten. `mirrorAllowed` (per face) and `mirrorAll` (pack setting) decide `use_face` mirroring. The face route `/faces/<id>/...` is files; `/faces` alone is the UI page. Quality thresholds are in `QUALITY`. Details: the contract's "Face pack".
- **Brand assets are copies.** `web/public/brand/` and `web/src/brand/imago-icons.ts` come from
  `Instrumenta/brand/`. Regenerate them there; do not edit them here.
