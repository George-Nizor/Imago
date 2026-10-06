import path from "node:path";

/**
 * Turns one `claude -p --output-format stream-json --verbose` line into a small normalised event,
 * or null for anything we do not use. Shapes follow the Claude Code stream: `system/init`,
 * `assistant` and `user` messages holding content blocks, and the final `result`.
 */
export function interpretLine(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }
  if (!obj || typeof obj !== "object") return [];
  const out = [];
  if (obj.type === "system" && obj.subtype === "init") {
    out.push({ kind: "init", sessionId: typeof obj.session_id === "string" ? obj.session_id : null });
  } else if (obj.type === "assistant" || obj.type === "user") {
    const content = obj.message?.content;
    if (typeof content === "string") {
      if (obj.type === "assistant" && content.trim()) out.push({ kind: "text", text: content });
      return out;
    }
    for (const block of Array.isArray(content) ? content : []) {
      if (obj.type === "assistant" && block?.type === "text" && block.text?.trim()) out.push({ kind: "text", text: block.text });
      else if (obj.type === "assistant" && block?.type === "tool_use") {
        out.push({ kind: "tool_use", id: block.id, name: block.name, input: block.input ?? {} });
      } else if (obj.type === "user" && block?.type === "tool_result") {
        out.push({ kind: "tool_result", toolUseId: block.tool_use_id, isError: Boolean(block.is_error), text: resultText(block.content) });
      }
    }
  } else if (obj.type === "result") {
    out.push({
      kind: "result",
      sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
      isError: Boolean(obj.is_error) || (typeof obj.subtype === "string" && obj.subtype.startsWith("error")),
      text: typeof obj.result === "string" ? obj.result : "",
      costUsd: Number(obj.total_cost_usd ?? obj.cost_usd ?? 0) || 0,
      durationMs: Number(obj.duration_ms ?? 0) || 0,
    });
  }
  return out;
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
}

const leaf = (p) => (typeof p === "string" ? path.basename(p) : "file");

/** The one-line "what is Claude doing" shown in the UI. */
export function summarizeTool(name, input = {}) {
  switch (name) {
    case "Write":
      return `Writing ${leaf(input.file_path)}`;
    case "Edit":
      return `Editing ${leaf(input.file_path)}`;
    case "Read":
      return `Reading ${leaf(input.file_path)}`;
    case "Glob":
      return "Looking at the project files";
    case "mcp__imago__render":
      return "Rendering";
    case "mcp__imago__cut_out":
      return `Removing the background of ${input.asset ?? "an image"}`;
    case "mcp__imago__search_images":
      return `Searching stock images for "${String(input.query ?? "").slice(0, 60)}"`;
    case "mcp__imago__fetch_image":
      return "Fetching an image";
    case "WebSearch":
      return `Searching the web for "${String(input.query ?? "").slice(0, 60)}"`;
    case "WebFetch":
      return "Reading a web page";
    default:
      return name;
  }
}

export const SIGNED_OUT = /not logged in|please run \/login|invalid api key|authentication|authenticat|oauth|credential|sign(?:ed)?[- ]?in|log(?:ged)?[- ]?in/i;
