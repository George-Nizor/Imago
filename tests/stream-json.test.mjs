import assert from "node:assert/strict";
import { test } from "node:test";
import { runProcess } from "../server/process.mjs";
import { SIGNED_OUT, interpretLine, summarizeTool } from "../server/stream-json.mjs";

const line = (o) => JSON.stringify(o);

test("system/init carries the session id", () => {
  assert.deepEqual(interpretLine(line({ type: "system", subtype: "init", session_id: "abc", tools: [] })), [{ kind: "init", sessionId: "abc" }]);
});

test("assistant content blocks become text and tool_use events", () => {
  const events = interpretLine(line({
    type: "assistant",
    message: { content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "t1", name: "mcp__imago__render", input: {} }, { type: "thinking", thinking: "..." }] },
  }));
  assert.deepEqual(events, [{ kind: "text", text: "Hello" }, { kind: "tool_use", id: "t1", name: "mcp__imago__render", input: {} }]);
});

test("user tool_result keeps the id, error flag and joined text (images dropped)", () => {
  const [ev] = interpretLine(line({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: [{ type: "image", source: {} }, { type: "text", text: "{\"version\":2}" }] }] },
  }));
  assert.deepEqual(ev, { kind: "tool_result", toolUseId: "t1", isError: false, text: "{\"version\":2}" });
});

test("result carries cost, duration and the error flag", () => {
  const [ok] = interpretLine(line({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "s", total_cost_usd: 0.0123, duration_ms: 4500 }));
  assert.deepEqual(ok, { kind: "result", sessionId: "s", isError: false, text: "done", costUsd: 0.0123, durationMs: 4500 });
  const [bad] = interpretLine(line({ type: "result", subtype: "error_during_execution", is_error: true }));
  assert.equal(bad.isError, true);
});

test("noise is ignored", () => {
  for (const l of ["", "not json", "[]", "null", line({ type: "stream_event" }), line({ type: "assistant", message: {} })]) assert.deepEqual(interpretLine(l), []);
});

test("tool summaries", () => {
  assert.equal(summarizeTool("Write", { file_path: "/p/x/design.html" }), "Writing design.html");
  assert.equal(summarizeTool("mcp__imago__render"), "Rendering");
  assert.match(summarizeTool("mcp__imago__cut_out", { asset: "face.png" }), /face\.png/);
});

test("signed-out detection", () => {
  assert.ok(SIGNED_OUT.test("Invalid API key · Please run /login"));
  assert.ok(SIGNED_OUT.test("Not logged in"));
  assert.ok(!SIGNED_OUT.test("Rendered a first version."));
});

test("runProcess delivers stdout lines as they arrive, split across chunks", async () => {
  const lines = [];
  const script = 'process.stdout.write("one\\ntw"); setTimeout(()=>process.stdout.write("o\\nthree"),30)';
  const result = await runProcess({ binary: process.execPath, args: ["-e", script], onStdoutLine: (l) => lines.push(l) });
  assert.equal(result.code, 0);
  assert.deepEqual(lines, ["one", "two", "three"]);
});

test("runProcess kills the whole group on timeout and on abort", async () => {
  const hang = ["-e", "require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000)"];
  const t = await runProcess({ binary: process.execPath, args: hang, timeoutMs: 300, killGraceMs: 300 });
  assert.equal(t.timedOut, true);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const a = await runProcess({ binary: process.execPath, args: hang, signal: controller.signal, killGraceMs: 300 });
  assert.equal(a.aborted, true);
});

test("runProcess rejects when the program does not exist", async () => {
  await assert.rejects(runProcess({ binary: "/nonexistent/claude" }), (e) => e.code === "ENOENT");
});
