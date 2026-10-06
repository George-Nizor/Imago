#!/usr/bin/env node
// Stands in for `claude` in tests: same arguments and stdin, a scripted stream-json answer, and a
// real render through the real render MCP. FAKE_CLAUDE_MODE = signed-out | fail | slow | early-fail (dies before init) | resume-fail (a --resume finds no conversation).
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "";
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

if (argv[0] === "--version") {
  console.log("0.0.0 (Fake Claude)");
  process.exit(0);
}
if (argv[0] === "auth" && argv[1] === "status") {
  console.log(JSON.stringify({ loggedIn: mode !== "signed-out", authMethod: "fake" }));
  process.exit(mode === "signed-out" ? 1 : 0);
}

// Leave a record of how we were called, for the tests.
const stdin = fs.readFileSync(0, "utf8");
// The system prompt arrives as a file (--append-system-prompt-file) that is deleted after the turn: read it now.
const systemFile = flag("--append-system-prompt-file");
const systemPrompt = systemFile && fs.existsSync(systemFile) ? fs.readFileSync(systemFile, "utf8") : null;
fs.writeFileSync("fake-claude-call.json", JSON.stringify({ argv, stdin, systemPrompt, systemFile }, null, 2));
// Tests that need every call's arguments (the file above is overwritten each turn) set this.
if (process.env.FAKE_CLAUDE_ARGS_OUT) fs.appendFileSync(process.env.FAKE_CLAUDE_ARGS_OUT, `${JSON.stringify({ argv, stdin, systemPrompt })}\n`);

if (mode === "early-fail") {
  process.stderr.write("boom before init\n");
  process.exit(2);
}
if (mode === "resume-fail" && flag("--resume")) {
  process.stderr.write(`No conversation found with session ID: ${flag("--resume")}\n`);
  process.exit(1);
}

const sessionId = flag("--resume") ?? "fake-session-1";
send({ type: "system", subtype: "init", session_id: sessionId, model: flag("--model"), tools: [] });

if (mode === "signed-out") {
  send({ type: "result", subtype: "success", is_error: true, result: "Invalid API key · Please run /login", session_id: sessionId, total_cost_usd: 0, duration_ms: 5 });
  process.exit(1);
}
if (mode === "fail") {
  process.stderr.write("something exploded\n");
  process.exit(3);
}
if (mode === "slow") {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

// FAKE_CLAUDE_STOCK=1 plays a fetch_image call: the file and its sidecar are written as the real tool would.
const fetchedStock = process.env.FAKE_CLAUDE_STOCK === "1";
if (fetchedStock) {
  fs.mkdirSync("assets", { recursive: true });
  fs.writeFileSync("assets/stock-fake.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  fs.writeFileSync("assets/stock-fake.png.json", JSON.stringify({ url: "https://example.org/fake.png", credit: "Ada Lens", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", source: "example", fetchedAt: new Date().toISOString() }));
}

const mcp = JSON.parse(flag("--mcp-config").trim().startsWith("{") ? flag("--mcp-config") : fs.readFileSync(flag("--mcp-config"), "utf8")).mcpServers.imago;
const width = Number(mcp.env.IMAGO_WIDTH);
const height = Number(mcp.env.IMAGO_HEIGHT);
const asset = fs.existsSync("assets") ? fs.readdirSync("assets").find((f) => /\.(png|jpg|webp)$/.test(f)) : null;

fs.writeFileSync(
  "design.html",
  `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="/fonts/fonts.css">
<style>
html,body{margin:0}
body{width:${width}px;height:${height}px;overflow:hidden;position:relative;background:linear-gradient(135deg,#0b3d91,#e4572e);font-family:"Anton",sans-serif}
h1{position:absolute;left:48px;top:48px;margin:0;color:#fff;font-size:${Math.round(height / 5)}px}
img{position:absolute;right:40px;bottom:0;height:60%}
</style></head>
<body><h1>FAKE DESIGN</h1>${asset ? `<img src="assets/${asset}" alt="">` : ""}</body></html>
`,
);

send({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Drafting the design." }] }, session_id: sessionId });
send({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_w", name: "Write", input: { file_path: `${process.cwd()}/design.html`, content: "..." } }] }, session_id: sessionId });
send({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_w", content: "File created" }] }, session_id: sessionId });

if (fetchedStock) {
  send({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_f", name: "mcp__imago__fetch_image", input: { url: "https://example.org/fake.png" } }] }, session_id: sessionId });
  send({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_f", content: [{ type: "text", text: '{"name":"stock-fake.png","width":1,"height":1}' }] }] }, session_id: sessionId });
}

const client = new Client({ name: "fake-claude", version: "0" });
await client.connect(new StdioClientTransport({ command: mcp.command, args: mcp.args, env: mcp.env }));
send({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_r", name: "mcp__imago__render", input: {} }] }, session_id: sessionId });
const rendered = await client.callTool({ name: "render", arguments: {} });
await client.close();
send({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_r", is_error: Boolean(rendered.isError), content: rendered.content }] }, session_id: sessionId });
send({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Rendered a first version." }] }, session_id: sessionId });
send({ type: "result", subtype: "success", is_error: false, result: "Rendered a first version.", session_id: sessionId, total_cost_usd: 0, duration_ms: 1234 });
