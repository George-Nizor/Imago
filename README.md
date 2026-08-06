# Framekit

Personal lightweight thumbnail & title-card editor, plus an MCP server so Cursor (or any MCP client) can open the app and generate thumbnails for you.

## Run the editor

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## MCP server (LLM control)

The MCP lives in [`mcp/`](mcp/) and exposes tools for:

| Tool | Purpose |
|------|---------|
| `open_framekit` | Start Vite if needed and open the UI (`home` / `thumbnail` / `title-card`) |
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

### Enable in Cursor

Project config is already at [`.cursor/mcp.json`](.cursor/mcp.json). Restart Cursor MCP / reload the window, then ask things like:

> Create a YouTube thumbnail titled "BOSS FIGHT" with subject `/path/to/face.png` and support image `/path/to/game.png` on the right, then open the result.

Install MCP deps once:

```bash
cd mcp && npm install
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

1. **Thumbnail Composer** — 1280×720, auto background, subject outline, brand text, export JPG.
2. **Title Card** — 1920×1080 transparent canvas, export PNG.

## Notes

- Background removal downloads a local model on first use (browser or MCP node package).
- UI brand kit uses `localStorage`; MCP brand kit uses `.framekit/brand-kit.json`.
- Exports land in `exports/`.
