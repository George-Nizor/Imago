# Imago MCP

The Imago MCP server exposes the editor's reusable thumbnail workflow over stdio. It can create and revise self-contained layer documents, render stills or animations locally, hand a document to the source editor, and run the original one-shot generators.

The production entrypoint is `dist/mcp/src/index.js`. It advertises 34 tools, server instructions, bounded schemas, mirrored text/structured output, and MCP annotations describing read, write, destructive, idempotent, and local-only behaviour.

## Install, build, and verify

Node 20 or newer is required.

```bash
cd Imago/mcp
npm ci
npm run typecheck
npm test
```

`npm ci` runs `prepare`, which compiles the server. `npm test` rebuilds it and launches the real compiled entrypoint through an MCP stdio client; it negotiates the protocol, lists tools, executes an editable composition and PNG/GIF export, and checks malformed calls, unknown tools, path confinement, and overwrite protection.

Run the compiled server manually with:

```bash
npm start
```

Do not print application output to this process's stdout: stdout is reserved for MCP JSON-RPC. Tool results are returned through the protocol.

## Client configuration

The Imago workspace includes `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "imago": {
      "command": "node",
      "args": ["mcp/dist/mcp/src/index.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

For a client that does not expand `${workspaceFolder}`, use the absolute path to the `Imago` directory as `cwd`. Build the server before reconnecting the client.

Optional environment overrides:

| Variable | Default | Purpose |
|---|---|---|
| `IMAGO_ROOT` | Parent of the detected `imago-mcp` package | Imago source root used to launch Vite |
| `IMAGO_DATA_DIR` | `Imago/.imago` | Brand settings, preferences, and editable documents |
| `IMAGO_EXPORTS_DIR` | `Imago/exports` | The only directory MCP exports can write or open |
| `IMAGO_URL` | `http://localhost:5173` | Local source-editor URL |

## Recommended editable workflow

1. Call `list_templates` and choose an exact template, output size, and slot set.
2. Call `create_document` with a stable lowercase `documentId` and explicit `seed`.
3. Fill labelled image slots with `replace_slot`; reuse a subject path on later documents, or add free layers with `import_image`.
4. Revise the composition with `update_text`, `update_layer`, `set_background`, layer-stack tools, grading, beauty, and animation tools.
5. Call `export_document` or `export_animation`.
6. Optionally call `open_document_in_imago_source` to continue visually in the source editor.

Documents are stored as `.imago/documents/<id>.imago.json`. Media is canonicalised to embedded PNG data, so documents do not depend on source paths after import. `get_document` redacts embedded image bytes by default; set `includeDataUrls: true` only when the client can accept a large protocol response.

Every document mutation also requires the `contentHash` returned by the immediately preceding read or mutation as `expectedHash`; stale writes fail and report the current hash. Existing documents and exports are never replaced unless `overwrite: true` is explicit. Overwrites replace the target directory entry through a staged file, so a pre-existing link cannot redirect writes outside the allowed directory. Source images must be absolute regular files, are decoded locally, and are capped at 64 MiB and 100 megapixels. Still exports are capped at 40 megapixels; animation exports at 80 megapixel-frames.

## Tool inventory

### Editable documents (22)

| Area | Tools |
|---|---|
| Catalog and lifecycle | `list_templates`, `create_document`, `list_documents`, `get_document`, `delete_document` |
| Slots and imports | `replace_slot`, `import_image` |
| Layers and text | `add_text`, `update_layer`, `update_text`, `duplicate_layer`, `delete_layer`, `reorder_layer` |
| Look development | `set_background`, `cutout_layer`, `set_image_grade`, `apply_beauty`, `edit_image_pixels` |
| Animation and output | `edit_animation`, `export_document`, `export_animation` |
| Visual continuation | `open_document_in_imago_source` |

### One-shot and control tools (12)

| Tool | Purpose |
|---|---|
| `open_imago` | Open the home, thumbnail, or title-card source workflow |
| `create_youtube_thumbnail` | One-pass 4K/1080p/720p thumbnail export |
| `create_title_card` | One-pass transparent title-card export |
| `create_video_artefact` | Intro, chapter, lower-third, end-slate, name-tag, or quote artwork |
| `create_modern_artefact` | Mesh, chrome, neon, duotone, glass, depth, magazine, brutalist, or aurora artwork |
| `create_guided_thumbnail` | Opinionated safe-zone and hierarchy-based thumbnail |
| `remove_background` | Standalone local cutout to PNG |
| `list_background_variants` | Read generated-background IDs |
| `list_fonts` | Read MCP font families and roles |
| `get_brand_kit`, `update_brand_kit` | Read or update the MCP brand kit |
| `open_export` | Open an existing file confined to `exports/` |

## Editor-to-MCP coverage

| Editor capability | MCP coverage | Notes |
|---|---|---|
| Documents | Full | Create, inspect, list, overwrite explicitly, and confirmed delete |
| Thumbnail templates and sizes | Full, shared source | Uses the same six templates, three sizes, slot geometry, and title fitting as the web editor |
| Replaceable template slots | Full | Background, subject, support, automatic slot cutout, and outline defaults |
| Free image import | Full | Contain/cover fit into a normalized box, optional cutout and outline |
| Layer stack | Core | Visibility, opacity, lock, name, role, transform, blend, outline, duplicate, reorder, delete |
| Text and effects | Full | Content, typography, placement, and all shared effect recipes |
| Generated backgrounds | Full | All shared variants, explicit seed, and optional brand colours |
| Cutout | Full local operation | Strict failure: a failed model pass never silently changes the document |
| Beauty | Algorithm parity | Bakes the editor's lightweight smoothing/highlight heuristic into the image |
| Grade | Full | Live brightness/contrast/saturation or explicit baked pixels |
| Erase and liquify | Full bounded recipe | Normalized erase/warp/bloat/pucker strokes, 128-point cap, 16 MP working cap |
| Still export | Full core output | PNG/JPG, active frame, optional bounded resize |
| Animation | Full core output | Duplicate/delete/move/select frames, FPS, GIF, and PNG sequence |
| App handoff | Source editor only | `open_document_in_imago_source` uses a validated local-only Vite route |
| Brand and one-shot generators | Existing MCP surface | Retained for fast non-iterative jobs |

## Deliberate limitations

- Crop remains a visual-editor operation. Erase and liquify are available as explicit normalized stroke recipes through `edit_image_pixels`.
- The browser's recent-cutout shelf stays in browser IndexedDB. MCP does not scrape browser storage; instead, callers can reuse the same absolute subject file and each editable document embeds its result.
- Handoff opens a validated snapshot in the source Vite editor. Changes made in that browser tab are not written back to the MCP document automatically, and the installed static Electron editor does not expose the source-only handoff endpoint.
- Local background removal may acquire its model on first use, depending on the upstream IMG.LY cache state. Image pixels are processed locally and are not uploaded by Imago.
- Beauty is intentionally the editor's lightweight heuristic, not landmark-aware face retouching.
- Editable MCP rendering supports Imago's current `normal` and `multiply` blend modes and PNG/JPG/GIF/PNG-sequence output; it does not encode video files.
- UI brand state uses browser storage while MCP brand state is `.imago/brand-kit.json`; neither silently overwrites the other.
