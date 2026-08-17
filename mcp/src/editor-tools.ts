import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TextEffect } from '../../src/types/document.js';
import { openImago, rememberLastExport } from './app-control.js';
import {
  TEXT_EFFECT_IDS,
  addTextLayer,
  applyBeautyToLayer,
  createDocumentModel,
  cutoutLayer,
  deleteDocument,
  deleteLayer,
  duplicateLayer,
  editImageLayerPixels,
  editAnimation,
  importImageLayer,
  listDocuments,
  readDocument,
  reorderLayer,
  replaceTemplateSlot,
  saveNewDocument,
  setBackground,
  setImageGrade,
  summarize,
  templateCatalog,
  updateLayer,
  updateTextLayer,
} from './document-model.js';
import { exportAnimationFile, exportDocumentFile } from './document-renderer.js';
import { BACKGROUND_VARIANTS } from './paths.js';
import { ImagoInputError, errorMessage } from './safety.js';

const identifier = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .describe('Stable lowercase ID: letters, numbers, hyphens, underscores');
const documentHash = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe('contentHash returned by the immediately preceding document read or mutation');
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const finite = z.number().finite();
const normalizedBox = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001, {
    message: 'box must remain inside the normalized canvas',
  });
const textEffect = z.enum(TEXT_EFFECT_IDS as [TextEffect, ...TextEffect[]]);
const backgroundVariant = z.enum(BACKGROUND_VARIANTS as [string, ...string[]]);
const summaryOutput = {
  id: z.string(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  transparent: z.boolean(),
  templateId: z.string().optional(),
  layerCount: z.number(),
  frameCount: z.number(),
  fps: z.number(),
  filePath: z.string(),
  contentHash: documentHash,
};
const localRead = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const localWrite = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const toolOutput = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, ok: z.boolean().optional(), error: z.string().optional() })
    .partial();

function response<T extends object>(value: T) {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

function safe<T extends object, A extends unknown[]>(
  handler: (...args: A) => T | Promise<T>,
) {
  return async (...args: A) => {
    try {
      return response(await handler(...args));
    } catch (cause) {
      const value = { ok: false, error: errorMessage(cause) };
      return {
        isError: true,
        structuredContent: value,
        content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
      };
    }
  };
}

export function registerEditorTools(server: McpServer): void {
  server.registerTool(
    'list_templates',
    {
      title: 'List Imago templates',
      description: 'List the exact thumbnail templates, sizes, backgrounds, slots, and text effects used by the web editor.',
      inputSchema: {},
      outputSchema: toolOutput({ catalog: z.record(z.string(), z.unknown()) }),
      annotations: localRead,
    },
    safe(async () => ({ catalog: templateCatalog() })),
  );

  server.registerTool(
    'create_document',
    {
      title: 'Create editable Imago document',
      description: 'Create a deterministic, self-contained .imago.json document from a thumbnail template, title card, or custom canvas.',
      inputSchema: {
        documentId: identifier,
        name: z.string().trim().min(1).max(120),
        kind: z.enum(['thumbnail', 'title-card', 'custom']),
        templateId: z.string().optional(),
        sizeId: z.enum(['youtube-4k', 'youtube-1080', 'youtube-720']).optional(),
        width: z.number().int().min(64).max(8192).optional(),
        height: z.number().int().min(64).max(8192).optional(),
        transparent: z.boolean().optional(),
        title: z.string().max(500).optional(),
        seed: z.number().int().min(0).max(2_147_483_647).optional(),
        overwrite: z.boolean().optional().describe('Required to replace an existing document with the same ID'),
        expectedHash: documentHash.optional().describe('Required with overwrite=true when the document already exists'),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(async ({ overwrite, expectedHash, ...options }) =>
      saveNewDocument(createDocumentModel(options), overwrite, expectedHash)),
  );

  server.registerTool(
    'list_documents',
    {
      title: 'List editable Imago documents',
      description: 'List persisted MCP documents and identify invalid document files without modifying them.',
      inputSchema: {},
      outputSchema: toolOutput({
        documents: z.array(z.object(summaryOutput)),
        invalidFiles: z.array(z.string()),
      }),
      annotations: localRead,
    },
    safe(async () => listDocuments()),
  );

  server.registerTool(
    'get_document',
    {
      title: 'Get Imago document',
      description: 'Read editable layer and animation state. Embedded image bytes are redacted by default; opt in only when the client can accept a large response.',
      inputSchema: {
        documentId: identifier,
        includeDataUrls: z
          .boolean()
          .optional()
          .describe('Return embedded image bytes. Defaults to false to keep protocol messages bounded'),
      },
      outputSchema: toolOutput({
        summary: z.object(summaryOutput),
        document: z.record(z.string(), z.unknown()),
      }),
      annotations: localRead,
    },
    safe(async ({ documentId, includeDataUrls }) => {
      const document = readDocument(documentId);
      const result = structuredClone(document) as unknown as Record<string, unknown>;
      if (includeDataUrls !== true) redactDataUrls(result);
      return { summary: summarize(document), document: result };
    }),
  );

  server.registerTool(
    'delete_document',
    {
      title: 'Delete Imago document',
      description: 'Delete one named MCP document. This never deletes exports or source images.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        confirm: z.literal(true).describe('Must be true to confirm deletion'),
      },
      outputSchema: toolOutput({ ok: z.boolean(), documentId: z.string() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safe(async ({ documentId, expectedHash }) => {
      deleteDocument(documentId, expectedHash);
      return { ok: true, documentId };
    }),
  );

  server.registerTool(
    'replace_slot',
    {
      title: 'Replace template slot',
      description: 'Replace a labelled background, subject, or support slot while preserving the template geometry.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        slotId: z.string().min(1).max(80),
        inputPath: z.string().min(1).describe('Absolute local image path'),
        removeBackground: z.boolean().optional().describe('Defaults to the slot cutout setting'),
        outline: z.boolean().optional().describe('Defaults to the slot outline setting'),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(replaceTemplateSlot),
  );

  server.registerTool(
    'import_image',
    {
      title: 'Import image layer',
      description: 'Embed a local image as a self-contained free layer in an Imago document.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        inputPath: z.string().min(1).describe('Absolute local image path'),
        layerId: identifier,
        name: z.string().trim().min(1).max(120).optional(),
        role: z.enum(['subject', 'support', 'none']).optional(),
        fit: z.enum(['contain', 'cover']).optional(),
        box: normalizedBox.optional(),
        removeBackground: z.boolean().optional(),
        outline: z.boolean().optional(),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, idempotentHint: false },
    },
    safe(async (options) => importImageLayer({ ...options, role: options.role ?? 'support' })),
  );

  server.registerTool(
    'add_text',
    {
      title: 'Add text layer',
      description: 'Add editable text with an Imago text-effect preset and normalized placement.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        layerId: identifier,
        text: z.string().min(1).max(500),
        name: z.string().trim().min(1).max(120).optional(),
        effect: textEffect.optional(),
        x: z.number().min(0).max(1).optional(),
        y: z.number().min(0).max(1).optional(),
        fontSize: z.number().min(1).max(2000).optional(),
        fontFamily: z.string().min(1).max(200).optional(),
        fill: color.optional(),
        stroke: color.optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, idempotentHint: false },
    },
    safe(addTextLayer),
  );

  server.registerTool(
    'update_layer',
    {
      title: 'Update layer',
      description: 'Update common layer state, transforms, blend, role, and image outline without replacing media.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        layerId: identifier,
        name: z.string().trim().min(1).max(120).optional(),
        role: z.enum(['background', 'subject', 'support', 'text', 'none']).optional(),
        visible: z.boolean().optional(),
        opacity: z.number().min(0).max(1).optional(),
        locked: z.boolean().optional(),
        blendMode: z.enum(['normal', 'multiply']).optional(),
        transform: z
          .object({
            x: finite.min(-100_000).max(100_000).optional(),
            y: finite.min(-100_000).max(100_000).optional(),
            scaleX: finite.min(-100).max(100).optional(),
            scaleY: finite.min(-100).max(100).optional(),
            rotation: finite.min(-36_000).max(36_000).optional(),
          })
          .optional(),
        outline: z
          .object({
            enabled: z.boolean().optional(),
            width: z.number().min(0).max(500).optional(),
            color: color.optional(),
          })
          .optional(),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: localWrite,
    },
    safe(updateLayer),
  );

  server.registerTool(
    'update_text',
    {
      title: 'Update text and effect',
      description: 'Edit text content, typography, colors, alignment, and the full Imago effect recipe.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        layerId: identifier,
        text: z.string().min(1).max(500).optional(),
        effect: textEffect.optional(),
        fontFamily: z.string().min(1).max(200).optional(),
        fontSize: z.number().min(1).max(2000).optional(),
        fontWeight: z.number().int().min(100).max(1000).optional(),
        fill: color.optional(),
        stroke: color.optional(),
        strokeWidth: z.number().min(0).max(500).optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
        letterSpacing: z.number().min(-100).max(500).optional(),
        extrudeDepth: z.number().min(0).max(500).optional(),
        extrudeAngle: z.number().min(0).max(360).optional(),
        extrudeColor: color.optional(),
        gradientFrom: color.optional(),
        gradientTo: color.optional(),
        skewX: z.number().min(-0.35).max(0.35).optional(),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: localWrite,
    },
    safe(updateTextLayer),
  );

  server.registerTool(
    'set_background',
    {
      title: 'Set generated background',
      description: 'Create or replace the generated background with an explicit deterministic seed and optional colors.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        variant: backgroundVariant,
        seed: z.number().int().min(0).max(2_147_483_647),
        primary: color.optional(),
        accent: color.optional(),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(async (options) => setBackground({ ...options, variant: options.variant as never })),
  );

  server.registerTool(
    'duplicate_layer',
    {
      title: 'Duplicate layer',
      description: 'Duplicate one non-template layer using a caller-provided stable ID.',
      inputSchema: { documentId: identifier, expectedHash: documentHash, layerId: identifier, newLayerId: identifier },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, idempotentHint: false },
    },
    safe(async ({ documentId, expectedHash, layerId, newLayerId }) =>
      duplicateLayer(documentId, expectedHash, layerId, newLayerId)),
  );

  server.registerTool(
    'delete_layer',
    {
      title: 'Delete layer',
      description: 'Delete one non-template layer from the active animation frame.',
      inputSchema: { documentId: identifier, expectedHash: documentHash, layerId: identifier, confirm: z.literal(true) },
      outputSchema: toolOutput(summaryOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safe(async ({ documentId, expectedHash, layerId }) => deleteLayer(documentId, expectedHash, layerId)),
  );

  server.registerTool(
    'reorder_layer',
    {
      title: 'Reorder layer',
      description: 'Move one non-template layer to an explicit stack index.',
      inputSchema: { documentId: identifier, expectedHash: documentHash, layerId: identifier, toIndex: z.number().int().min(0).max(99) },
      outputSchema: toolOutput(summaryOutput),
      annotations: localWrite,
    },
    safe(async ({ documentId, expectedHash, layerId, toIndex }) =>
      reorderLayer(documentId, expectedHash, layerId, toIndex)),
  );

  server.registerTool(
    'cutout_layer',
    {
      title: 'Remove layer background',
      description: 'Run local ONNX background removal on an embedded image layer and keep it editable.',
      inputSchema: { documentId: identifier, expectedHash: documentHash, layerId: identifier },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(async ({ documentId, expectedHash, layerId }) => cutoutLayer(documentId, expectedHash, layerId)),
  );

  server.registerTool(
    'set_image_grade',
    {
      title: 'Set image grade',
      description: 'Set brightness, contrast, and saturation; optionally bake pixels and reset live grade values.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        layerId: identifier,
        brightness: z.number().min(-50).max(50),
        contrast: z.number().min(-50).max(50),
        saturation: z.number().min(-50).max(50),
        bake: z.boolean().optional(),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(async ({ documentId, expectedHash, layerId, bake, brightness, contrast, saturation }) =>
      setImageGrade({
        documentId,
        expectedHash,
        layerId,
        grade: { brightness, contrast, saturation },
        bake,
      }),
    ),
  );

  server.registerTool(
    'apply_beauty',
    {
      title: 'Apply beauty pass',
      description: 'Bake the same local lightweight skin-smoothing and highlight-lift algorithm used by the web editor.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        layerId: identifier,
        amount: z.number().min(0).max(100),
        smooth: z.number().min(0).max(1).optional(),
        eyes: z.number().min(0).max(1).optional(),
        teeth: z.number().min(0).max(1).optional(),
        underEye: z.number().min(0).max(1).optional(),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(async ({ documentId, expectedHash, layerId, amount, smooth, eyes, teeth, underEye }) =>
      applyBeautyToLayer({
        documentId,
        expectedHash,
        layerId,
        beauty: {
          amount,
          smooth: smooth ?? 0.5,
          eyes: eyes ?? 0.4,
          teeth: teeth ?? 0.3,
          underEye: underEye ?? 0.4,
        },
      }),
    ),
  );

  server.registerTool(
    'edit_image_pixels',
    {
      title: 'Edit image pixels',
      description: 'Bake an erase, warp, bloat, or pucker stroke into one image layer using the editor liquify/erase math. Points and radius are normalized to the source image.',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        layerId: identifier,
        mode: z.enum(['erase', 'warp', 'bloat', 'pucker']),
        points: z
          .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
          .min(1)
          .max(128),
        radius: z.number().min(0.001).max(0.5).describe('Brush radius as a fraction of the shorter image edge'),
        strength: z.number().min(0.01).max(1).optional(),
        soft: z.boolean().optional().describe('Soft erase edge; ignored by liquify modes'),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safe(async ({ strength, soft, ...options }) =>
      editImageLayerPixels({ ...options, strength: strength ?? 0.55, soft: soft ?? true })),
  );

  server.registerTool(
    'edit_animation',
    {
      title: 'Edit animation filmstrip',
      description: 'Duplicate, delete, move, or select a frame, or set playback FPS (1-30).',
      inputSchema: {
        documentId: identifier,
        expectedHash: documentHash,
        action: z.enum(['duplicate', 'delete', 'move', 'select', 'set-fps']),
        index: z.number().int().min(0).max(47).optional(),
        toIndex: z.number().int().min(0).max(47).optional(),
        fps: z.number().int().min(1).max(30).optional(),
      },
      outputSchema: toolOutput(summaryOutput),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(editAnimation),
  );

  server.registerTool(
    'export_document',
    {
      title: 'Export Imago document',
      description: 'Render the active frame to PNG or JPG under exports/ with explicit overwrite protection.',
      inputSchema: {
        documentId: identifier,
        format: z.enum(['png', 'jpg']),
        outputName: z.string().min(1).max(100).optional(),
        overwrite: z.boolean().optional(),
        width: z.number().int().min(64).max(8192).optional(),
        height: z.number().int().min(64).max(8192).optional(),
      },
      outputSchema: toolOutput({
        outputPath: z.string(),
        width: z.number(),
        height: z.number(),
        format: z.enum(['png', 'jpg']),
      }),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(async ({ documentId, ...options }) => {
      requirePairedDimensions(options.width, options.height);
      const result = await exportDocumentFile({ document: readDocument(documentId), ...options });
      rememberLastExport(result.outputPath);
      return result;
    }),
  );

  server.registerTool(
    'export_animation',
    {
      title: 'Export Imago animation',
      description: 'Render all frames to an animated GIF or numbered PNG sequence with a bounded pixel budget.',
      inputSchema: {
        documentId: identifier,
        format: z.enum(['gif', 'png-sequence']),
        outputName: z.string().min(1).max(100).optional(),
        overwrite: z.boolean().optional(),
        width: z.number().int().min(64).max(4096).optional(),
        height: z.number().int().min(64).max(4096).optional(),
      },
      outputSchema: toolOutput({
        format: z.enum(['gif', 'png-sequence']),
        outputPath: z.string().optional(),
        framePaths: z.array(z.string()).optional(),
        width: z.number(),
        height: z.number(),
        frameCount: z.number(),
        fps: z.number(),
      }),
      annotations: { ...localWrite, destructiveHint: true, idempotentHint: false },
    },
    safe(async ({ documentId, ...options }) => {
      requirePairedDimensions(options.width, options.height);
      const result = await exportAnimationFile({ document: readDocument(documentId), ...options });
      if (result.outputPath) rememberLastExport(result.outputPath);
      else if (result.framePaths?.[0]) rememberLastExport(result.framePaths[0]);
      return result;
    }),
  );

  server.registerTool(
    'open_document_in_imago_source',
    {
      title: 'Open document in Imago source editor',
      description: 'Start the source editor and hand off a persisted MCP document through its local-only Vite endpoint.',
      inputSchema: { documentId: identifier, startServer: z.boolean().optional() },
      outputSchema: toolOutput({
        ok: z.literal(true),
        url: z.string(),
        startedServer: z.boolean(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safe(async ({ documentId, startServer }) => {
      readDocument(documentId);
      const result = await openImago({ documentId, startServer });
      return { ok: true, url: result.url, startedServer: result.started };
    }),
  );
}

function redactDataUrls(value: Record<string, unknown>): void {
  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      if (key === 'src' && typeof child === 'string' && child.startsWith('data:image/')) {
        (candidate as Record<string, unknown>)[key] = `[embedded image: ${child.length} characters]`;
      } else {
        visit(child);
      }
    }
  };
  visit(value);
}

function requirePairedDimensions(width?: number, height?: number): void {
  if ((width === undefined) !== (height === undefined)) {
    throw new ImagoInputError('width and height must be provided together');
  }
}
