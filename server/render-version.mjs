// One render of a project's design.html as a new version: validate, snapshot, render, and for a thumbnail
// the feed mock-up and checks. Shared by the render MCP (Claude's `render`) and the server's own renders
// (refreshing faces), so both leave exactly the same files.
import fs from "node:fs/promises";
import path from "node:path";
import { computeChecks } from "./checks.mjs";
import { highestVersion, validateDesignFile } from "./design-files.mjs";
import { stageFeed } from "./feed.mjs";
import { renderHtml } from "./renderer.mjs";

/**
 * `project`: {dir, size, preset, format, title, id, conceptSetId}. Resolves {errors} when design.html does not
 * validate, else {version, warnings, checks, image, feed} (`checks` only for a thumbnail; `feed` is a file or null).
 * A render failure throws.
 */
export async function renderVersion(config, project) {
  const { dir, size } = project;
  const { errors, warnings } = await validateDesignFile(dir, size, config.fontsDir);
  if (errors.length) return { errors };
  const version = (await highestVersion(dir)) + 1;
  const snapshot = path.join(dir, "versions", `v${version}.html`);
  const out = path.join(dir, "renders", `v${version}.png`);
  await fs.copyFile(path.join(dir, "design.html"), snapshot);
  // Thumbnails are also judged in context: measured, then shown in a feed. Neither can fail the render.
  const judged = project.preset === "thumbnail";
  const feedOut = path.join(dir, "renders", `v${version}-feed.png`);
  const staged = judged ? await stageFeed({ config, format: project.format || "video", title: project.title ?? "", projectId: project.id ?? path.basename(dir), conceptSetId: project.conceptSetId || null, outFile: feedOut }).catch(() => null) : null;
  let result;
  try {
    // Rendered from design.html itself so relative assets/ paths resolve; the snapshot is identical.
    result = await renderHtml(config, { htmlFile: path.join(dir, "design.html"), ...size, scale: 1, format: "png", out, measure: judged, feedJob: staged?.jobFile });
  } finally {
    await staged?.cleanup();
  }
  let checks;
  if (judged && result.measure) {
    try {
      checks = computeChecks({ format: project.format || "video", title: project.title ?? "", measure: result.measure, neighbours: { labs: (result.feed?.neighbours ?? []).map((n) => n.meanLab), source: staged?.source } });
    } catch {
      checks = [];
    }
  }
  return { version, warnings, ...(checks ? { checks } : {}), image: out, feed: result.feed ? feedOut : null };
}
