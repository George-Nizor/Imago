# Imago

Imago is Instrumenta's local image compositor for repeatable thumbnails, title cards, and short frame animations. It includes a visual slot-based workflow and an MCP server for compatible clients.

## Run the editor

Imago is a standalone repository. The editor and its MCP server can be built and tested without an
Instrumenta checkout; Instrumenta discovers the optional integration through
`instrumenta/product.json`.

```bash
npm install
npm run dev
```

Open the printed localhost URL. Choose one of six thumbnail compositions, choose a working resolution, then replace the labelled subject, supporting-image, and background slots. Subject slots run local background isolation automatically and retain their template position. Successful subject cutouts appear in the image-first **Recent cutouts** shelf: select one to fill the next composition's subject slot instantly without running segmentation again, or use its delete control to remove it. Headline replacement, brand styling, layout, and 4K export remain editable.

The composition panel shows the next empty visual slot and changes to **Ready to export** when the template is filled. Recoverable failures appear as accessible in-app notices with a stable `IMAGO-*` diagnostic code; raw file names, image data, and error messages are not included in production diagnostics.

The editor offers three resolution-independent 16:9 sizes:

- **4K · 3840×2160** — recommended export size;
- **1080p · 1920×1080** — default working canvas for a fast editing view;
- **720p · 1280×720** — lightweight compatibility output.

Use the filmstrip under the canvas to add frames, scrub with ←/→, play with Space, and export an animated **GIF**. Every icon control has an accessible name and reveals its full label on hover or keyboard focus.

Open http://localhost:5173.

## MCP server (LLM control)

The MCP lives in [`mcp/`](mcp/) and exposes 34 annotated tools. The recommended iterative path is `list_templates` → `create_document` → slot/layer/text/pixel edits → `export_document`; mutations use the returned `contentHash` as `expectedHash` to reject stale writes.

| Tool | Purpose |
|------|---------|
| `open_imago` | Start Vite if needed and open the UI (`home` / `thumbnail` / `title-card`) |
| `create_youtube_thumbnail` | One-shot 1280×720 compose → `exports/*.jpg` |
| `create_title_card` | Transparent PNG title card |
| `create_video_artefact` | Cinematic lockups: intro/chapter/lower-third/end-slate/quote |
| `create_modern_artefact` | Modern looks: mesh, liquid chrome, neon, duotone, glass-over-photo, depth-stack, magazine, brutalist, aurora |
| `create_guided_thumbnail` | Thumbnail Guide layouts (≤4 words, safe zones, hierarchy) |
| `remove_background` | Local cutout → PNG |
| `list_background_variants` | solid, split, panels, punch, … |
| `list_fonts` | Available typography families |
| `get_brand_kit` / `update_brand_kit` | Shared brand colors/fonts |
| `open_export` | Open a result in Preview/Finder |

The editable surface also includes document lifecycle, all six shared templates and three resolutions, replaceable slots, imports, layer/text/background edits, cutout, grade, beauty, erase/liquify pixel recipes, animation, PNG/JPG/GIF/PNG-sequence export, and source-editor handoff. See [`mcp/README.md`](mcp/README.md) for the exact 34-tool inventory and limitations.

### Enable in Cursor

Project config is already at [`.cursor/mcp.json`](.cursor/mcp.json). Restart the MCP client / reload the window, then ask things like:

> Create a YouTube thumbnail titled "BOSS FIGHT" with subject `/path/to/face.png` and support image `/path/to/game.png` on the right, then open the result.

Install MCP deps once:

```bash
cd mcp && npm ci
```

### Example tool call shape

```json
{
  "title": "BOSS FIGHT",
  "subjectPath": "/Users/you/Pictures/face.png",
  "supportImages": [{ "path": "/Users/you/Pictures/boss.png", "layout": "right" }],
  "background": "panels",
  "openResult": true
}
```

Deep links: `http://localhost:5173/#workflow=thumbnail` and `#workflow=title-card`.

## Manual workflows

1. **Thumbnail Composer** — six reusable slot-based layouts, automatic subject isolation, replace-in-place imagery, brand text, and 4K/1080p/720p JPG or PNG export.
2. **Title Card** — 1920×1080 transparent canvas, export PNG.

## Verification

```bash
npm test
npm run build
npm run lint
npm run check:bundle
npm --prefix mcp test
```

The repository keeps generated `dist/`, `exports/`, and dependency folders out of Git. Its CI runs
the editor tests, lint, production bundle gate, and MCP tests independently.

## Repository structure

`src/` contains the editor, `mcp/` contains the local MCP server, `public/` contains product assets,
`tests/` covers the editor contract, and `instrumenta/product.json` describes how the optional suite
launcher builds and serves Imago.

The pure tests check normalized geometry, unique slot identities, contain/cover placement, proportional resolution scaling, supported outputs, safe fallbacks, title fitting, reusable-subject deduplication/cap policies, diagnostic codes, and the production bundle policy. `npm run build` also runs the bundle check automatically.

## Notes

- The template browser and editor shell are separate production chunks. Canvas/Konva loads only after a composition is chosen; ONNX/WASM and the smaller quantized cutout model load only after explicit cutout intent. First-use download progress appears in the editor, then the browser cache handles later cutouts. Images are processed on-device and are never sent with the model request.
- ONNX Runtime 1.21 publishes separate default and WebGPU ESM entry files, but their contents are identical apart from the pthread worker's self-filename; both register WebGPU and WASM. Vite resolves both IMG.LY branches to the default entry, saving 789,694 runtime bytes while preserving GPU selection and CPU fallback. The build compares the installed upstream files byte-for-byte after normalising only that filename and fails closed if a future upgrade makes the alias unsafe.
- The remaining ONNX `.js`/`.mjs` pair is intentional rather than duplicate package waste. The `.js` is Vite's main-thread module and the unchanged `.mjs` is the URL-addressable module used when ONNX spawns pthread workers. The single 23.9 MB JSEP WASM binary supports both WebGPU and threaded CPU execution. All three files remain deferred.
- The release bundle gate caps the initial JavaScript entry at 320 KiB, walks its static import graph to reject eager cutout loading, requires exactly one ONNX main module, pthread worker, and JSEP WASM binary, and caps their combined payload at 24 MiB. The current initial entry is about 244 KiB before gzip.
- Up to eight recent cutouts are stored as PNG blobs in browser IndexedDB, deduplicated by SHA-256 content, and bounded by per-item and total-byte caps. They never leave the browser. Clearing site data removes them.
- UI brand kit uses namespaced `localStorage`; MCP brand kit uses `.imago/brand-kit.json`.
- Existing Framekit/Pedit settings are read as a one-way compatibility fallback.
- Exports land in `exports/`.
