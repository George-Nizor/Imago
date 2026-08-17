#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openImago, openFile, rememberLastExport } from './app-control.js';
import {
  createYouTubeThumbnail,
  createTitleCard,
  removeBackgroundFile,
} from './composer.js';
import { createVideoArtefact } from './artefacts.js';
import { createModernArtefact } from './modern.js';
import { createGuidedThumbnail } from './thumbnailGuide.js';
import { FONT_CATALOG } from './typography.js';
import { registerEditorTools } from './editor-tools.js';
import { assertExportPath } from './safety.js';
import {
  BACKGROUND_VARIANTS,
  loadBrand,
  saveBrand,
  EXPORTS_DIR,
} from './paths.js';

const server = new McpServer({
  name: 'imago',
  version: '0.1.0',
}, {
  instructions:
    'Use editable document tools for iterative compositions: list_templates → create_document → replace_slot/import_image/add_text → export_document. Use one-shot create_* tools only when no later editing or app handoff is needed. All media processing is local. Paths must be absolute. Existing documents and exports are never overwritten unless overwrite=true.',
});

const brandPatchSchema = z
  .object({
    primary: z.string().optional(),
    accent: z.string().optional(),
    textFill: z.string().optional(),
    textStroke: z.string().optional(),
    textStrokeWidth: z.number().optional(),
    titleSize: z.number().optional(),
    subjectOutlineColor: z.string().optional(),
    subjectOutlineWidth: z.number().optional(),
    fontFamily: z.string().optional(),
  })
  .optional();

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const additiveFileAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const localUiAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const legacyOutputSchema = z.object({}).loose();

function legacyResult(value: Record<string, unknown>) {
  return {
    structuredContent: value,
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

server.registerTool(
  'open_imago',
  {
    title: 'Open Imago',
    description:
      'Start the Imago web app (if needed) and open it in the browser. Use path=thumbnail or title-card to jump into a workflow.',
    inputSchema: {
      startServer: z
        .boolean()
        .optional()
        .describe('Start Vite if not running (default true)'),
      path: z
        .enum(['home', 'thumbnail', 'title-card'])
        .optional()
        .describe('Which screen to open'),
    },
    outputSchema: legacyOutputSchema,
    annotations: localUiAnnotations,
  },
  async ({ startServer, path }) => {
    const result = await openImago({ startServer, path });
    return legacyResult({
      ok: true,
      url: result.url,
      startedServer: result.started,
      hint: 'UI is open. Prefer create_youtube_thumbnail for automated exports.',
    });
  },
);

server.registerTool(
  'create_youtube_thumbnail',
  {
    title: 'Create YouTube thumbnail',
    description:
      'Compose a 4K, 1080p, or 720p YouTube thumbnail with auto background, optional subject (cutout+outline), supporting images, and bold title text. Defaults to 1080p and saves JPG under exports/.',
    inputSchema: {
      title: z.string().describe('Main thumbnail title text'),
      subjectPath: z
        .string()
        .optional()
        .describe('Absolute path to face/subject photo'),
      supportImages: z
        .array(
          z.object({
            path: z.string(),
            layout: z.enum(['left', 'right', 'behind', 'badge']).optional(),
            removeBackground: z.boolean().optional(),
          }),
        )
        .optional()
        .describe('Extra cutout images around the subject'),
      background: z.enum(BACKGROUND_VARIANTS as [string, ...string[]]).optional(),
      sizeId: z.enum(['youtube-4k', 'youtube-1080', 'youtube-720']).optional(),
      seed: z.number().optional().describe('Background RNG seed for rerolls'),
      removeSubjectBackground: z.boolean().optional(),
      outlineSubject: z.boolean().optional(),
      outputName: z.string().optional(),
      overwrite: z.boolean().optional().describe('Replace an existing export with this name'),
      brand: brandPatchSchema,
      textEffect: z
        .enum([
          'basic',
          'yt-bold',
          'comic',
          'neon',
          'chrome',
          'gradient',
          'extrude-3d',
          'bevel',
          'stack-shadow',
          'retro',
        ])
        .optional()
        .describe('Text look: extrude-3d, yt-bold, neon, chrome, …'),
      openResult: z
        .boolean()
        .optional()
        .describe('Open the exported JPG after creation'),
      openEditor: z
        .boolean()
        .optional()
        .describe('Also open Imago UI after export'),
    },
    outputSchema: legacyOutputSchema,
    annotations: additiveFileAnnotations,
  },
  async (args) => {
    const result = await createYouTubeThumbnail({
      title: args.title,
      subjectPath: args.subjectPath,
      supportImages: args.supportImages,
      background: args.background as import('./paths.js').BackgroundVariant | undefined,
      seed: args.seed,
      removeSubjectBackground: args.removeSubjectBackground,
      outlineSubject: args.outlineSubject,
      outputName: args.outputName,
      overwrite: args.overwrite,
      brand: args.brand,
      textEffect: args.textEffect,
      sizeId: args.sizeId,
    });
    rememberLastExport(result.outputPath);
    if (args.openResult) await openFile(result.outputPath);
    if (args.openEditor) await openImago({ path: 'thumbnail' });
    return legacyResult({
      ok: true,
      outputPath: result.outputPath,
      size: `${result.width}x${result.height}`,
      exportsDir: EXPORTS_DIR,
    });
  },
);

server.registerTool(
  'create_title_card',
  {
    title: 'Create title card',
    description:
      'Create a transparent PNG title card (default 1920×1080) with brand text styling.',
    inputSchema: {
      title: z.string(),
      subtitle: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      outputName: z.string().optional(),
      overwrite: z.boolean().optional().describe('Replace an existing export with this name'),
      brand: brandPatchSchema,
      openResult: z.boolean().optional(),
      openEditor: z.boolean().optional(),
    },
    outputSchema: legacyOutputSchema,
    annotations: additiveFileAnnotations,
  },
  async (args) => {
    const result = await createTitleCard(args);
    rememberLastExport(result.outputPath);
    if (args.openResult) await openFile(result.outputPath);
    if (args.openEditor) await openImago({ path: 'title-card' });
    return legacyResult({
      ok: true,
      outputPath: result.outputPath,
      size: `${result.width}x${result.height}`,
    });
  },
);

server.registerTool(
  'remove_background',
  {
    title: 'Remove background',
    description:
      'Remove background from an image file (local ONNX) and save a transparent PNG to exports/.',
    inputSchema: {
      inputPath: z.string().describe('Absolute path to source image'),
      outputName: z.string().optional(),
      overwrite: z.boolean().optional().describe('Replace an existing export with this name'),
      openResult: z.boolean().optional(),
    },
    outputSchema: legacyOutputSchema,
    annotations: additiveFileAnnotations,
  },
  async ({ inputPath, outputName, overwrite, openResult }) => {
    const outputPath = await removeBackgroundFile(inputPath, outputName, overwrite);
    rememberLastExport(outputPath);
    if (openResult) await openFile(outputPath);
    return legacyResult({ ok: true, outputPath });
  },
);

server.registerTool(
  'list_background_variants',
  {
    title: 'List background variants',
    description: 'List Imago auto-background style IDs for thumbnails.',
    inputSchema: {},
    outputSchema: legacyOutputSchema,
    annotations: readOnlyAnnotations,
  },
  async () => legacyResult({ variants: BACKGROUND_VARIANTS }),
);

server.registerTool(
  'get_brand_kit',
  {
    title: 'Get brand kit',
    description: 'Read the saved Imago brand kit (colors, fonts, outline defaults).',
    inputSchema: {},
    outputSchema: legacyOutputSchema,
    annotations: readOnlyAnnotations,
  },
  async () => legacyResult(loadBrand() as unknown as Record<string, unknown>),
);

server.registerTool(
  'update_brand_kit',
  {
    title: 'Update brand kit',
    description: 'Patch and persist the Imago brand kit used by MCP compositions.',
    inputSchema: {
      primary: z.string().optional(),
      accent: z.string().optional(),
      textFill: z.string().optional(),
      textStroke: z.string().optional(),
      textStrokeWidth: z.number().optional(),
      titleSize: z.number().optional(),
      subjectOutlineColor: z.string().optional(),
      subjectOutlineWidth: z.number().optional(),
      fontFamily: z.string().optional(),
    },
    outputSchema: legacyOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (patch) => {
    const brand = saveBrand(patch);
    return legacyResult({ ok: true, brand });
  },
);

server.registerTool(
  'create_video_artefact',
  {
    title: 'Create video artefact',
    description:
      'Create video-ready overlays/title cards: intro-card, chapter-card, lower-third, end-slate, name-tag, quote-card. Cinematic lockup compositions: tracked-caps kickers, foil hero text (gold/silver/rose) with bevel+sheen, keyline frames, diamond dividers, ghost numerals, layered plates. Lower-thirds/name-tags export transparent PNG for editors.',
    inputSchema: {
      kind: z.enum([
        'intro-card',
        'chapter-card',
        'lower-third',
        'end-slate',
        'name-tag',
        'quote-card',
      ]),
      title: z.string(),
      subtitle: z.string().optional(),
      backgroundPath: z.string().optional(),
      mood: z.enum(['noir', 'ember', 'fog', 'deep-teal', 'paper']).optional(),
      font: z
        .enum(['playfair', 'cinzel', 'bebas', 'oswald', 'archivo', 'anton'])
        .optional(),
      style: z
        .enum([
          'editorial',
          'film-credits',
          'soft-lume',
          'knockout',
          'image-clip',
          'yt-punch',
          'ghost-overlap',
          'glass',
        ])
        .optional(),
      blendMode: z.enum(['none', 'image-clip', 'knockout']).optional(),
      material: z
        .enum(['foil-gold', 'foil-silver', 'foil-rose', 'ivory'])
        .optional()
        .describe('Hero text material; foil fills get bevel + sheen'),
      transparent: z.boolean().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      outputName: z.string().optional(),
      overwrite: z.boolean().optional().describe('Replace an existing export with this name'),
      openResult: z.boolean().optional(),
    },
    outputSchema: legacyOutputSchema,
    annotations: additiveFileAnnotations,
  },
  async (args) => {
    const result = await createVideoArtefact(args);
    rememberLastExport(result.outputPath);
    if (args.openResult) await openFile(result.outputPath);
    return legacyResult({ ok: true, ...result });
  },
);

server.registerTool(
  'create_modern_artefact',
  {
    title: 'Create modern text artefact',
    description:
      'Modern/sleek text artefacts that go beyond cinematic templates: mesh-poster, liquid-chrome, neon-grid, duotone-photo, glass-over-photo, depth-stack (text behind subject), magazine, brutalist, aurora-type. Pass photoPath to integrate a real background image.',
    inputSchema: {
      look: z.enum([
        'mesh-poster',
        'liquid-chrome',
        'neon-grid',
        'duotone-photo',
        'glass-over-photo',
        'depth-stack',
        'magazine',
        'brutalist',
        'aurora-type',
      ]),
      title: z.string(),
      subtitle: z.string().optional(),
      kicker: z.string().optional(),
      photoPath: z.string().optional().describe('Real photo to integrate; required for best photo looks'),
      accent: z.string().optional(),
      accent2: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      transparent: z.boolean().optional(),
      outputName: z.string().optional(),
      overwrite: z.boolean().optional().describe('Replace an existing export with this name'),
      openResult: z.boolean().optional(),
    },
    outputSchema: legacyOutputSchema,
    annotations: additiveFileAnnotations,
  },
  async (args) => {
    const { openResult, ...rest } = args;
    const result = await createModernArtefact(rest);
    rememberLastExport(result.outputPath);
    if (openResult) await openFile(result.outputPath);
    return legacyResult({ ok: true, ...result });
  },
);

server.registerTool(
  'create_guided_thumbnail',
  {
    title: 'Create guided YouTube thumbnail',
    description:
      'Compose a 4K, 1080p, or 720p thumbnail using Ultimate Thumbnail Guide rules: ≤4 words, ≤3 elements, scaled safe zones, soft vignette, darkened/blurred BG, large Anton/block type, and high contrast. Defaults to 1080p.',
    inputSchema: {
      text: z.string().describe('Punchy curiosity text, ideally ≤4 words'),
      layout: z
        .enum([
          'face-left-text-right',
          'face-right-text-left',
          'curiosity-center',
          'symbol-focus',
          'before-after',
        ])
        .optional(),
      subjectPath: z.string().optional(),
      supportPath: z.string().optional(),
      backgroundPath: z.string().optional(),
      mood: z.enum(['noir', 'ember', 'fog', 'deep-teal', 'paper']).optional(),
      textColor: z.enum(['#ffffff', '#000000', '#ffe566', '#f0ede6', '#f4efe4']).optional(),
      removeSubjectBackground: z.boolean().optional(),
      vignette: z.boolean().optional(),
      sizeId: z.enum(['youtube-4k', 'youtube-1080', 'youtube-720']).optional(),
      outputName: z.string().optional(),
      overwrite: z.boolean().optional().describe('Replace an existing export with this name'),
      openResult: z.boolean().optional(),
    },
    outputSchema: legacyOutputSchema,
    annotations: additiveFileAnnotations,
  },
  async (args) => {
    const result = await createGuidedThumbnail(args);
    rememberLastExport(result.outputPath);
    if (args.openResult) await openFile(result.outputPath);
    return legacyResult({ ok: true, ...result });
  },
);

server.registerTool(
  'list_fonts',
  {
    title: 'List Imago fonts',
    description: 'List available MCP typography fonts and roles.',
    inputSchema: {},
    outputSchema: legacyOutputSchema,
    annotations: readOnlyAnnotations,
  },
  async () => legacyResult({ fonts: FONT_CATALOG }),
);

server.registerTool(
  'open_export',
  {
    title: 'Open export file',
    description: 'Open a previously exported Imago file in the system viewer.',
    inputSchema: {
      path: z.string().describe('Absolute path to an image in exports/'),
    },
    outputSchema: legacyOutputSchema,
    annotations: localUiAnnotations,
  },
  async ({ path }) => {
    const exportPath = assertExportPath(path);
    await openFile(exportPath);
    return legacyResult({ ok: true, opened: exportPath });
  },
);

registerEditorTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
