import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { validateDesign } from "./validate.mjs";

/** Font family names from fonts.json (validator input and the system prompt). */
export function fontFamilies(fontsDir) {
  try {
    return JSON.parse(readFileSync(path.join(fontsDir, "fonts.json"), "utf8")).families.map((f) => f.family);
  } catch {
    return [];
  }
}

export async function validateDesignFile(projectDir, size, fontsDir) {
  let html;
  try {
    html = await fs.readFile(path.join(projectDir, "design.html"), "utf8");
  } catch {
    return { errors: ["design.html does not exist yet. Write it with the Write tool first."], warnings: [] };
  }
  return validateDesign(html, { width: size.width, height: size.height, fonts: fontFamilies(fontsDir) });
}

/** Highest n among versions/v<n>.html and renders/v<n>.png. */
export async function highestVersion(projectDir) {
  let highest = 0;
  for (const [sub, ext] of [["versions", "html"], ["renders", "png"]]) {
    for (const entry of await fs.readdir(path.join(projectDir, sub)).catch(() => [])) {
      const m = new RegExp(`^v(\\d+)\\.${ext}$`).exec(entry);
      if (m) highest = Math.max(highest, Number(m[1]));
    }
  }
  return highest;
}
