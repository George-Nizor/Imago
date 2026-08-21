![Imago banner](docs/images/imago-banner.png)

# Imago

Imago is a local graphics compositor for thumbnails, title cards, layered stills, and short frame
animations. The browser editor handles direct work. Its MCP server exposes the same document model to
Codex and other compatible clients.

Current version: **0.1.0**.

## Run the editor

```bash
npm install
npm run dev
```

Open the localhost address printed by Vite. Instrumenta can also build and open Imago from its sibling
checkout.

A production build uses:

```bash
npm run build
npm run preview
```

## What the editor does

The thumbnail workflow starts with one of six reusable layouts at 4K, 1080p, or 720p. Replace the
labelled image slots, edit the headline, adjust the brand styling, and export PNG or JPG.

Subject slots can run local background isolation. Successful cutouts are kept in a bounded Recent
cutouts shelf in browser IndexedDB, ready for another composition. The shelf holds up to eight PNGs,
deduplicates them by content hash, and disappears when site data is cleared.

The title-card workflow uses a transparent 1920×1080 canvas. The frame strip can add and reorder
frames, scrub with the arrow keys, play with Space, and export GIF or a PNG sequence.

All layers remain editable. Imago reports recoverable problems inside the editor with stable
`IMAGO-*` codes instead of dumping raw image data into diagnostics.

## Files and privacy

Images are processed on the machine. Background removal uses the local ONNX model after the user asks
for a cutout. The first use may download the model runtime; later sessions use the browser cache.

Editor exports land in `exports/`. A shocking development, but at least the folder is honest.

The visual editor stores its brand kit in namespaced browser storage. The MCP server keeps its own
brand kit at `.imago/brand-kit.json`. Generated exports, build output, dependencies, and local MCP
documents stay out of Git.

## MCP control

The local server lives in [`mcp/`](mcp/) and currently exposes 34 annotated tools. Install and run it
with:

```bash
npm --prefix mcp install
npm run mcp
```

The normal editable sequence is:

```text
list_templates
→ create_document
→ replace_slot / import_image / add_text
→ edit layers, pixels, grade, or animation
→ export_document
```

Each mutation returns a `contentHash`. Send that value back as `expectedHash` on the next mutation;
stale edits are rejected instead of quietly winning.

Useful groups include:

- document creation, inspection, duplication, and deletion;
- template slots, free image layers, ordering, transforms, blend, and visibility;
- local cutout, erase/liquify pixel edits, grading, and beauty adjustments;
- editable text with bundled type and effect recipes;
- deterministic backgrounds and a shared MCP brand kit;
- frame animation with PNG, JPG, GIF, and PNG-sequence export;
- source-editor handoff and opening a finished export.

The exact input contracts and current limits are in [the MCP guide](mcp/README.md).

A clean runtime audit currently reports four transitive advisories under @imgly/background-removal-node.
The package has no complete upstream fix available in this lockfile.
Keep the MCP local and read [the dated dependency audit](docs/dependency-audit-2026-08-21.md) before
publishing it.

A request through a compatible client can be as plain as:

> Create a 1920×1080 title card called “Night Shift”, place
> `C:\Pictures\city.png` as the background, keep the text editable, then export a PNG.

All tool paths are absolute. Existing documents and exports refuse replacement unless `overwrite` is
explicitly true.

## Instrumenta integration

Imago is an independent repository. [`instrumenta/product.json`](instrumenta/product.json) declares
the optional `web-vite` integration. Instrumenta builds `dist/`, serves it on Imago's registered
loopback origin, and opens a sandboxed Electron window. The normal browser storage remains in place
across launcher upgrades.

## Verify a change

```bash
npm test
npm run lint
npm run build
npm run check:bundle
npm --prefix mcp test
```

The bundle check guards the initial JavaScript size, keeps the cutout runtime out of the eager import
graph, and verifies the ONNX worker/WASM set. That gate exists because a local editor can still become
bloated with considerable enthusiasm.

## Repository map

```text
src/          React editor and composition model
public/       product mark and browser assets
mcp/          local stdio server
tests/        editor, import, handoff, and production checks
scripts/      build and bundle verification
instrumenta/  launcher manifest
```

Imago is MIT licensed. Bundled fonts and libraries keep their own licences.
