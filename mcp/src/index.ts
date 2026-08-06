#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openFramekit, openFile, rememberLastExport } from './app-control.js';
import {
  createYouTubeThumbnail,
  createTitleCard,
  removeBackgroundFile,
} from './composer.js';
import { createVideoArtefact } from './artefacts.js';
import { createModernArtefact } from './modern.js';
import { createGuidedThumbnail } from './thumbnailGuide.js';
import { FONT_CATALOG } from './typography.js';
import {
  BACKGROUND_VARIANTS,
  loadBrand,
  saveBrand,
  EXPORTS_DIR,
} from './paths.js';

const server = new McpServer({
  name: 'framekit',
  version: '0.1.0',
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

server.registerTool(
  'open_framekit',
  {
    title: 'Open Framekit',
    description:
      'Start the Framekit web app (if needed) and open it in the browser. Use path=thumbnail or title-card to jump into a workflow.',
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
  },
  async ({ startServer, path }) => {
    const result = await openFramekit({ startServer, path });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              url: result.url,
              startedServer: result.started,
              hint: 'UI is open. Prefer create_youtube_thumbnail for automated exports.',
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  'create_youtube_thumbnail',
  {
    title: 'Create YouTube thumbnail',
    description:
      'Compose a 1280×720 YouTube thumbnail with auto background, optional subject (cutout+outline), supporting images, and bold title text. Saves JPG under exports/.',
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
      seed: z.number().optional().describe('Background RNG seed for rerolls'),
      removeSubjectBackground: z.boolean().optional(),
      outlineSubject: z.boolean().optional(),
      outputName: z.string().optional(),
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
        .describe('Also open Framekit UI after export'),
    },
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
      brand: args.brand,
      textEffect: args.textEffect,
    });
    rememberLastExport(result.outputPath);
    if (args.openResult) await openFile(result.outputPath);
    if (args.openEditor) await openFramekit({ path: 'thumbnail' });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              outputPath: result.outputPath,
              size: `${result.width}x${result.height}`,
              exportsDir: EXPORTS_DIR,
            },
            null,
            2,
          ),
        },
      ],
    };
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
      brand: brandPatchSchema,
      openResult: z.boolean().optional(),
      openEditor: z.boolean().optional(),
    },
  },
  async (args) => {
    const result = await createTitleCard(args);
    rememberLastExport(result.outputPath);
    if (args.openResult) await openFile(result.outputPath);
    if (args.openEditor) await openFramekit({ path: 'title-card' });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              outputPath: result.outputPath,
              size: `${result.width}x${result.height}`,
            },
            null,
            2,
          ),
        },
      ],
    };
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
      openResult: z.boolean().optional(),
    },
  },
  async ({ inputPath, outputName, openResult }) => {
    const outputPath = await removeBackgroundFile(inputPath, outputName);
    rememberLastExport(outputPath);
    if (openResult) await openFile(outputPath);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, outputPath }, null, 2) }],
    };
  },
);

server.registerTool(
  'list_background_variants',
  {
    title: 'List background variants',
    description: 'List Framekit auto-background style IDs for thumbnails.',
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ variants: BACKGROUND_VARIANTS }, null, 2),
      },
    ],
  }),
);

server.registerTool(
  'get_brand_kit',
  {
    title: 'Get brand kit',
    description: 'Read the saved Framekit brand kit (colors, fonts, outline defaults).',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(loadBrand(), null, 2) }],
  }),
);

server.registerTool(
  'update_brand_kit',
  {
    title: 'Update brand kit',
    description: 'Patch and persist the Framekit brand kit used by MCP compositions.',
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
  },
  async (patch) => {
    const brand = saveBrand(patch);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, brand }, null, 2) }],
    };
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
      openResult: z.boolean().optional(),
    },
  },
  async (args) => {
    const result = await createVideoArtefact(args);
    rememberLastExport(result.outputPath);
    if (args.openResult) await openFile(result.outputPath);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, ...result }, null, 2) }],
    };
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
      openResult: z.boolean().optional(),
    },
  },
  async (args) => {
    const { openResult, ...rest } = args;
    const result = await createModernArtefact(rest);
    rememberLastExport(result.outputPath);
    if (openResult) await openFile(result.outputPath);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, ...result }, null, 2) }],
    };
  },
);

server.registerTool(
  'create_guided_thumbnail',
  {
    title: 'Create guided YouTube thumbnail',
    description:
      'Compose a 1280×720 thumbnail using Ultimate Thumbnail Guide rules: ≤4 words, ≤3 elements, safe zones (avoid lower-right timestamp), soft vignette, darkened/blurred BG, large Anton/block type, high contrast. Prefer curiosity copy over title duplication.',
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
      textColor: z.enum(['#ffffff', '#000000', '#ffe566', '#f4efe4']).optional(),
      removeSubjectBackground: z.boolean().optional(),
      vignette: z.boolean().optional(),
      outputName: z.string().optional(),
      openResult: z.boolean().optional(),
    },
  },
  async (args) => {
    const result = await createGuidedThumbnail(args);
    rememberLastExport(result.outputPath);
    if (args.openResult) await openFile(result.outputPath);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, ...result }, null, 2) }],
    };
  },
);

server.registerTool(
  'list_fonts',
  {
    title: 'List Framekit fonts',
    description: 'List available MCP typography fonts and roles.',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ fonts: FONT_CATALOG }, null, 2) }],
  }),
);

server.registerTool(
  'open_export',
  {
    title: 'Open export file',
    description: 'Open a previously exported Framekit file in the system viewer.',
    inputSchema: {
      path: z.string().describe('Absolute path to an image in exports/'),
    },
  },
  async ({ path }) => {
    await openFile(path);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, opened: path }, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
