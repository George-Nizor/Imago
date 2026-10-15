# Imago on Windows without WSL: assessment

Written 2026-10-15, from a read of the code and of the two products already moved to Windows:
Discere (installed as a `managed-service`, release 1.1.x) and Fabula (native engine, release
0.4.0). Nothing here has been run on Windows yet. Where a point is inferred rather than observed,
it says so.

## Where Imago is today

Instrumenta starts Imago from the source checkout in WSL. It runs `npm start` there through
`wsl.exe` (adapter `web-service`). That means:

- Imago has no release. The only GitHub release, v0.1.0, is the old static photo editor from
  before the redesign. The checkout is 0.2.0.
- The installed launcher depends on the WSL checkout. A `git pull` or an unfinished branch
  changes what the owner uses, and Imago needs Claude Code signed in inside WSL.
- Its data lives in WSL, in `~/.local/share/imago`: projects, faces, brands, series and concept
  sets.

## What it takes

Imago is a Node HTTP server (`server/index.mjs`, port 49321, `GET /api/health`), a React and Vite
interface (`web/dist`) and a headless Electron renderer (`render/render.cjs`, one process per
render). It drives Claude Code with `claude -p` in stream-json mode and hands Claude an MCP server
(`server/render-mcp.mjs`) that renders, cuts out backgrounds and finds faces. It has no Python, no
database and no transcription. It is the same shape as Discere, plus Fabula's renderer problems.

### The release, following Discere

- Build on a `windows-latest` runner, as Discere does. `npm ci` there installs the Windows
  builds of the native parts, with no cross-installing:
  - `sharp` 0.32, which downloads libvips for win32 at install time;
  - `onnxruntime-node`, which already ships a win32 binary;
  - `electron.exe`.
- The zip holds:
  - a pinned `runtime/node.exe` (Discere pins Node 22.22.2 with a SHA-256);
  - `server/`, `render/` and `web/dist`;
  - the production `node_modules`, including Electron (the renderer needs it at runtime);
  - a generated `instrumenta/product.json`, with
    `launch.command: ["runtime/node.exe", "server/index.mjs"]`.

  It comes to roughly 600 MB unpacked: Electron 285 MB, onnxruntime 134 MB, the cut-out models
  127 MB. Expect about 250 MB zipped.
- A smoke test in CI starts the bundled server against a throwaway data folder and checks
  `/api/health` and the page.
- The manifest is written by Instrumenta's `instrumenta-release.cjs` with
  `--strategy managed-service --minimum 0.15.0`, and published on a `v<version>` tag.
- In the catalog, the `imago` entry changes `adapter` from `web-service` to `managed-service`.
  The CSP and session partition already exist.

### Changes in Instrumenta (blockers)

1. The launcher deletes an installed Imago. `electron/storage.cjs:33-39` lists
   `<installRoot>\imago` as retired data ("managed Imago release, now run from its checkout"), and
   `removeRetiredData` runs on every start. The entry has to go before any Imago release is
   installed.
2. The readiness list (`electron/readiness.cjs`) needs an Imago entry for Claude Code on
   Windows. While there, Discere's entry still says WSL and Codex and should be corrected.

### Changes in Imago

#### Blockers

- Fonts in the renderer. `render/render.cjs:82-83` maps `/fonts/` by checking whether the file
  URL's path starts with `/fonts/`. On Windows, `/fonts/x` inside `file:///C:/…/design.html`
  resolves to `C:/fonts/x`, which never matches, so every font would load as 403. This is inferred
  from the code. The fix is to map by the URL's pathname rather than the drive path.
- Finding claude.exe. `config.mjs:63` runs a bare `claude`, relying on PATH, and a manifest may
  not set PATH. The fix is a lookup: `IMAGO_CLAUDE_BIN`, `%USERPROFILE%\.local\bin\claude.exe`,
  `claude.exe` on PATH, then npm's shim resolved to its real file. Fabula's `scripts/agent-cli.cjs`
  and Dimensio's `claude.cjs` already do this. Never spawn a `.cmd`.
- Where data lives. On Windows the data folder becomes `%LOCALAPPDATA%\Imago`, as Discere uses
  `%LOCALAPPDATA%\Discere`. The first start copies `~/.local/share/imago` across from WSL, the way
  Fabula's setup copies projects (`Fabula/scripts/migrate-wsl.mjs`), and leaves WSL untouched.
  Any absolute WSL paths inside the data have to be rewritten.

#### The renderer, with what Fabula found

- Linux-only switches. `--no-zygote` is required only on Linux. `render.cjs` refuses to start
  without it today. Drop `--ozone-platform`, the Chromium libs and `LD_LIBRARY_PATH` on Windows.
- Display scaling. Add `--force-device-scale-factor=1`. Windows applies display scaling (175%
  on the owner's screen) to offscreen windows, and Fabula's cards came out at the wrong size until
  this was set.
- Window size. Set the content size again after creating a window. Windows clamps a new window
  to the screen, so a 1080×1920 vertical design would be laid out short; this is the same fix as
  Fabula's `fullSize`.

#### Processes

- Stopping a turn. `server/process.mjs:31-51` stops a turn with `child.kill`, which on Windows
  leaves Claude's MCP server and the Electron renderers running. Use `taskkill /PID <pid> /T /F`
  for the tree. Add `windowsHide: true` to every spawn.
- The MCP server's environment. `claude-runner.mjs:67` passes only POSIX variables. On Windows
  it needs `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, `SystemRoot` and `PATH` so
  node.exe and Electron can start.
- Shutdown. The launcher stops the service with `taskkill /T /F`, so Imago gets no chance to
  shut down cleanly on Windows. Every write already goes to a temporary file and is renamed, so
  that is safe, apart from the rename problem below.

#### Smaller items

- Renames over open files. On Windows these can fail with EPERM or EBUSY: the many
  `fs.rename` calls in store, faces, brands and concept-sets, and the trash moves. A short retry
  helper is enough.
- Entry-point check. `index.mjs:1062` compares `import.meta.url` with `argv[1]`. A different
  drive-letter case on Windows would make it skip starting the server silently. Compare
  normalised, case-insensitive paths instead.
- Fabula kits. `config.mjs:8-15` looks for Fabula projects in `~/.local/share/fabula/projects`
  and `../Fabula/media`. On Windows they are in `Videos\Fabula`, recorded in Fabula's
  `%LOCALAPPDATA%\Fabula\engine\settings.json`.
- Not yet tried with claude.exe on Windows:
  - the permission rules (`Read(./**)` and the others) with a Windows working folder;
  - the inline JSON `--mcp-config` on a Windows command line.

  Both need a real turn to confirm. Fabula's Windows assistant passes similar argv without trouble.

#### Tests

- The fake Claude, `tests/fixtures/fake-claude.mjs`, is run as a program through its shebang,
  which Windows cannot do. It needs a small `.cmd`-free launcher, or `IMAGO_CLAUDE_BIN` pointed at
  node with the script.
- `kits.test.mjs` makes symlinks, which needs Developer Mode on Windows.
- CI should gain a Windows job.

## Plan

1. Instrumenta: remove the retired-data entry and add the readiness entry, then release.
   (Small.)
2. Imago core: fonts mapping, claude.exe lookup, process-tree stop and `windowsHide`, MCP
   environment, renderer switches, scaling and window size, data folder, rename retry, entry
   check. Test by staging the code into a Windows folder made from WSL (see the note below). Then
   run the server natively, render designs including a vertical one, run a cut-out and one real
   Claude turn. (Medium.)
3. Data move: copy `~/.local/share/imago` into `%LOCALAPPDATA%\Imago` on first start. (Small.)
4. Release: a Windows release workflow modelled on Discere's, with a smoke test, then switch
   the catalog entry to `managed-service`. (Medium.)
5. Release 0.3.0 and move the owner over. The owner starts the launcher themselves (see the
   note below).

Overall this is smaller than Fabula's move: there is no engine setup, no model downloads and no
terminal. Most of the risk is in the renderer, and Fabula has already found the Windows problems
there.

## A note on testing from this workspace

Programs started from a Claude desktop session run inside its sandbox. New folders they create in
`%LOCALAPPDATA%` or `%APPDATA%` are quietly redirected into
`AppData\Local\Packages\Claude_…\LocalCache`. Two consequences:

- Make test folders from WSL first (`mkdir /mnt/c/...`).
- Never start the launcher, or an app's first run, from the session. The owner starts those
  themselves.
