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
| `server/render-mcp.mjs` | Stdio MCP server given to claude: `render` and `cut_out` |
| `server/validate.mjs` | The `design.html` rules |
| `server/capabilities.mjs` | Whether claude and the renderer are ready |
| `server/presets/` | `design-rules.md`, one prompt per preset, reference material |
| `render/render.cjs` | design.html to png, jpg or webp |
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
- **Brand assets are copies.** `web/public/brand/` and `web/src/brand/imago-icons.ts` come from
  `Instrumenta/brand/`. Regenerate them there; do not edit them here.
