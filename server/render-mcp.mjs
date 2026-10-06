// Stdio MCP server handed to `claude -p`: the tools `render` and `cut_out` for one project.
// stdout belongs to the protocol; never print to it.
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, packageVersion } from "./config.mjs";
import { cutOut } from "./cutout.mjs";
import { highestVersion, validateDesignFile } from "./design-files.mjs";
import { renderHtml } from "./renderer.mjs";
import { fetchStockImage, searchImages } from "./stock.mjs";

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
      // Rendered from design.html itself so relative assets/ paths resolve; the snapshot is identical.
      await renderHtml(config, { htmlFile: path.join(projectDir, "design.html"), ...size, scale: 1, format: "png", out });
      const data = (await fs.readFile(out)).toString("base64");
      return { content: [{ type: "image", data, mimeType: "image/png" }, { type: "text", text: JSON.stringify({ version, warnings }) }] };
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

await server.connect(new StdioServerTransport());
