import path from "node:path";

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LEAF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const isProjectId = (value) => typeof value === "string" && ID_PATTERN.test(value);

/** A single file name: no separators, no leading dot, no dot-dot, plain characters. */
export function isSafeLeaf(value) {
  return typeof value === "string" && LEAF_PATTERN.test(value) && !value.includes("..");
}

/** Turns whatever a browser sent as a file name into a safe leaf, keeping the extension. */
export function sanitizeLeaf(raw, fallback = "upload") {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  let name = base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".");
  name = name.replace(/^[^A-Za-z0-9]+/, "").slice(-100);
  return isSafeLeaf(name) ? name : fallback;
}

/** Joins safe leaf segments under a root; throws if any segment is unsafe or the result escapes. */
export function safeJoin(root, ...segments) {
  for (const segment of segments) {
    if (!isSafeLeaf(segment) && !ID_PATTERN.test(segment)) throw new PathError(`unsafe path segment: ${JSON.stringify(segment)}`);
  }
  const full = path.join(root, ...segments);
  if (path.relative(root, full).startsWith("..")) throw new PathError("path escapes its root");
  return full;
}

export class PathError extends Error {}
