// Stdio MCP server handed to `claude -p`: the tools `render` and `cut_out` for one project.
// stdout belongs to the protocol; never print to it.
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, packageVersion } from "./config.mjs";
import { computeChecks } from "./checks.mjs";
import { cutOut } from "./cutout.mjs";
import { highestVersion, validateDesignFile } from "./design-files.mjs";
import { stageFeed } from "./feed.mjs";
import { renderHtml } from "./renderer.mjs";
import { fetchStockImage, searchImages } from "./stock.mjs";
import { EXPRESSIONS, GAZES, GESTURES, GRADES, availability, facesRoot, rankFaces, readAllFaces, readSettings, summarize, takeFace } from "./face-pack.mjs";
import { renderFaceSheet } from "./face-sheet.mjs";
import os from "node:os";

const projectDir = path.resolve(process.env.IMAGO_PROJECT_DIR ?? "");
const config = loadConfig(process.env, process.env.IMAGO_FONTS_DIR ? { fontsDir: path.resolve(process.env.IMAGO_FONTS_DIR) } : {});
const size = { width: Number(process.env.IMAGO_WIDTH), height: Number(process.env.IMAGO_HEIGHT) };

const text = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });

const server = new McpServer({ name: "imago", version: packageVersion() });

server.registerTool(
  "render",
  { description: "Validate design.html, snapshot it as a new version and render it. Returns the image and any warnings; errors are returned as a list to fix." },
  async () => {
    try {
      if (!process.env.IMAGO_PROJECT_DIR || !(size.width > 0 && size.height > 0)) return text("The render tool is not configured for a project.", true);
      const { errors, warnings } = await validateDesignFile(projectDir, size, config.fontsDir);
      if (errors.length) return text(`design.html has errors; fix them and render again:\n${errors.map((e) => `- ${e}`).join("\n")}`, true);
      const version = (await highestVersion(projectDir)) + 1;
      const snapshot = path.join(projectDir, "versions", `v${version}.html`);
      const out = path.join(projectDir, "renders", `v${version}.png`);
      await fs.copyFile(path.join(projectDir, "design.html"), snapshot);
      // Thumbnails are also judged in context: measured, then shown in a feed. Neither can fail the render.
      const judged = process.env.IMAGO_PRESET === "thumbnail";
      const feedOut = path.join(projectDir, "renders", `v${version}-feed.png`);
      const staged = judged ? await stageFeed({ config, format: process.env.IMAGO_FORMAT || "video", title: process.env.IMAGO_BRIEF_TITLE ?? "", projectId: path.basename(projectDir), conceptSetId: process.env.IMAGO_CONCEPT_SET || null, outFile: feedOut }).catch(() => null) : null;
      let result;
      try {
        // Rendered from design.html itself so relative assets/ paths resolve; the snapshot is identical.
        result = await renderHtml(config, { htmlFile: path.join(projectDir, "design.html"), ...size, scale: 1, format: "png", out, measure: judged, feedJob: staged?.jobFile });
      } finally {
        await staged?.cleanup();
      }
      const content = [{ type: "image", data: (await fs.readFile(out)).toString("base64"), mimeType: "image/png" }];
      if (result.feed) content.push({ type: "image", data: (await fs.readFile(feedOut)).toString("base64"), mimeType: "image/png" });
      const reply = { version, warnings };
      if (judged && result.measure) {
        try {
          reply.checks = computeChecks({ format: process.env.IMAGO_FORMAT || "video", title: process.env.IMAGO_BRIEF_TITLE ?? "", measure: result.measure, neighbours: { labs: (result.feed?.neighbours ?? []).map((n) => n.meanLab), source: staged?.source } });
        } catch {
          reply.checks = [];
        }
      }
      return { content: [...content, { type: "text", text: JSON.stringify(reply) }] };
    } catch (error) {
      return text(`The render failed: ${error.message}`, true);
    }
  },
);

server.registerTool(
  "cut_out",
  {
    description: "Remove the background of assets/<asset> locally. Writes assets/<name>-cutout.png (transparent PNG; a number is appended if that name is taken) and returns its name and size.",
    inputSchema: { asset: z.string().describe("File name inside assets/, for example face.png") },
  },
  async ({ asset }) => {
    try {
      const result = await cutOut(projectDir, asset);
      return text({ name: result.name, width: result.width, height: result.height, from: result.from });
    } catch (error) {
      return text(`cut_out failed: ${error.message}`, true);
    }
  },
);

server.registerTool(
  "search_images",
  {
    description: "Search Openverse for openly licensed photos and textures (commercial use and modification allowed). Returns id, title, url, thumbnail, width, height, creator, license, license_url and source. Pick one, then fetch_image its url.",
    inputSchema: {
      query: z.string().describe("Two or three plain words work best, for example 'rocket launch night'"),
      count: z.number().int().min(1).max(20).optional().describe("How many results, 8 by default"),
    },
  },
  async ({ query, count }) => {
    try {
      return text(await searchImages({ query, count }));
    } catch (error) {
      return text(`search_images failed: ${error.message}`, true);
    }
  },
);

server.registerTool(
  "fetch_image",
  {
    description: "Download an https image (PNG, JPEG, WebP; GIF or AVIF are converted to PNG) into assets/ and return its name and size. Pass the credit and license so they are kept with the file. Use the returned name as assets/<name> in design.html.",
    inputSchema: {
      url: z.string().describe("Direct https URL of the image file"),
      credit: z.string().optional().describe("Who to credit, for example the creator's name"),
      license: z.string().optional().describe("For example 'CC BY 4.0' or 'CC0 1.0'"),
      license_url: z.string().optional().describe("Link to the license text"),
      source: z.string().optional().describe("Where it came from: the site or page"),
    },
  },
  async ({ url, credit, license, license_url, source }) => {
    try {
      if (!process.env.IMAGO_PROJECT_DIR) return text("The tool is not configured for a project.", true);
      return text(await fetchStockImage(projectDir, { url, credit, license, licenseUrl: license_url, source }));
    } catch (error) {
      return text(`fetch_image failed: ${error.message}`, true);
    }
  },
);

server.registerTool(
  "find_faces",
  {
    description: "Look through the owner's face pack (their own photos, already cut out and labelled) for the best faces for this design. Returns the best matches, starred first, with their labels and quality grade, and a numbered contact sheet image of them. Gaze is in image terms: 'left' means the face looks toward the left edge. Then use_face the one you want.",
    inputSchema: {
      expression: z.enum(EXPRESSIONS).optional(),
      gesture: z.enum(GESTURES).optional(),
      gaze: z.enum(GAZES).optional().describe("Where the face looks in the image, so you know which side the text goes"),
      minGrade: z.enum(GRADES).optional().describe("'4k' survives a 3x export filling half the canvas, 'hd' is fine up to 1.5x, 'soft' is anything"),
      count: z.number().int().min(1).max(8).optional().describe("How many, 4 by default"),
    },
  },
  async (query) => {
    try {
      const dataDir = process.env.IMAGO_DATA_DIR;
      if (!dataDir) return text("The tool is not configured.", true);
      const all = await readAllFaces(dataDir);
      const settings = await readSettings(dataDir);
      const found = rankFaces(all, { ...query, count: query.count ?? 4 });
      const reply = { faces: found.map((f, i) => ({ n: i + 1, ...summarize(f, settings) })), packHas: availability(all) };
      if (!found.length) {
        reply.note = Object.keys(reply.packHas).length ? "No face matches those filters; loosen one (the pack has the expressions listed in packHas)." : "The face pack has no usable faces.";
        return text(reply);
      }
      const content = [];
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "imago-find-faces-"));
      try {
        const out = path.join(dir, "sheet.png");
        const items = found.map((f) => ({ file: path.join(facesRoot(dataDir), f.id, f.cutout.thumb ? "thumb.png" : "cutout.png"), label: `${f.id}`, caption: `${f.labels.expression} ${f.labels.intensity} · ${f.labels.gaze} · ${f.quality?.grade ?? "?"}${f.starred ? " · starred" : ""}` }));
        if (await renderFaceSheet(config, items, { out, columns: Math.min(4, items.length), cell: 300, title: "Your face pack: best matches" })) content.push({ type: "image", data: (await fs.readFile(out)).toString("base64"), mimeType: "image/png" });
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
      return { content: [...content, { type: "text", text: JSON.stringify(reply) }] };
    } catch (error) {
      return text(`find_faces failed: ${error.message}`, true);
    }
  },
);

server.registerTool(
  "use_face",
  {
    description: "Copy a face from the owner's face pack into assets/ as face-<id>.png (a transparent cut-out, ready to place) or, with mirror, as face-<id>-mirrored.png with the pixels flipped. Refused when mirroring is not allowed for that face. Returns the name and size.",
    inputSchema: {
      id: z.string().describe("A face id from find_faces"),
      mirror: z.boolean().optional().describe("Flip it left to right so it looks toward the other side"),
    },
  },
  async ({ id, mirror }) => {
    try {
      if (!process.env.IMAGO_PROJECT_DIR || !process.env.IMAGO_DATA_DIR) return text("The tool is not configured for a project.", true);
      return text(await takeFace(process.env.IMAGO_DATA_DIR, projectDir, id, { mirror: mirror === true }));
    } catch (error) {
      return text(`use_face failed: ${error.message}`, true);
    }
  },
);

await server.connect(new StdioServerTransport());
