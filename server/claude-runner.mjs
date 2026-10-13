import { readFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readSeriesFile } from "./series.mjs";
import { readSnapshot } from "./brands.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpawnError, runProcess } from "./process.mjs";
import { registerCutout, syncAssets } from "./assets.mjs";
import { fontFamilies, highestVersion } from "./design-files.mjs";
import { buildFirstPrompt, brandSection, buildSystemPrompt, conceptSection, facesClassifySection, installCraft, plannerSection } from "./presets/index.mjs";
import { kitPromptSection } from "./kits.mjs";
import { SIGNED_OUT, interpretLine, summarizeTool } from "./stream-json.mjs";
import { electronEnv } from "./renderer.mjs";
import { formatOf } from "./feed.mjs";

// Built-in tools a turn can use (`--tools`; MCP tools are not built in, so they live in --allowedTools only).
const STANDARD_TOOLS = "Read,Write,Edit,Glob";
const FURTHER_TOOLS = `${STANDARD_TOOLS},WebSearch`;
const MCP_STANDARD = "mcp__imago__render,mcp__imago__cut_out,mcp__imago__find_faces,mcp__imago__use_face";
const MCP_FURTHER = `${MCP_STANDARD},mcp__imago__search_images,mcp__imago__fetch_image`;
// Permission rules (relative to the project folder, which is the working directory). Reads stay in the
// folder; the only file Claude may write is design.html. Everything else is the server's or the renderer's.
const SCOPED = "Read(./**),Glob(./**),Write(./design.html),Edit(./design.html)";
const NO_WRITE = ["./project.json", "./versions/**", "./renders/**", "./exports/**"].flatMap((p) => [`Write(${p})`, `Edit(${p})`]).join(",");
const STANDARD_DISALLOWED = `Bash,WebFetch,WebSearch,Task,NotebookEdit,${NO_WRITE}`;
const FURTHER_DISALLOWED = `Bash,WebFetch,Task,NotebookEdit,${NO_WRITE}`;

export const FURTHER_DIRECTION =
  "Take this design further: rethink it with full creative freedom and make it exceptional, keeping the brief's content and intent.";

let furtherPrompt;
const furtherText = () =>
  (furtherPrompt ??= readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "presets", "further.md"), "utf8").trim());

/** Which model, effort and tools a turn runs with. `modelKey` only matters for "further". */
export function resolveRun(config, mode = "standard", modelKey = "opus") {
  if (mode === "further") {
    const model = config.furtherModels?.[modelKey];
    if (!model) throw new Error(`Unknown model "${modelKey}" for a further turn.`);
    return { mode, modelKey, model, effort: config.furtherEffort, tools: FURTHER_TOOLS, allowed: `${SCOPED},${MCP_FURTHER},WebSearch`, disallowed: FURTHER_DISALLOWED };
  }
  return { mode: "standard", modelKey: null, model: config.model, effort: config.effort, tools: STANDARD_TOOLS, allowed: `${SCOPED},${MCP_STANDARD}`, disallowed: STANDARD_DISALLOWED };
}

export function mcpConfig(config, project, projectDir) {
  const env = {
    IMAGO_PROJECT_DIR: projectDir,
    IMAGO_FONTS_DIR: config.fontsDir,
    IMAGO_WIDTH: String(project.size.width),
    IMAGO_HEIGHT: String(project.size.height),
    IMAGO_ELECTRON_BIN: config.electronBin,
    IMAGO_CHROMIUM_LIBS: config.chromiumLibs,
    // What the render tool needs to judge a thumbnail in context: where the neighbours are and what it is called.
    IMAGO_DATA_DIR: config.dataDir,
    IMAGO_PROJECT_ID: project.id,
    IMAGO_PRESET: project.preset,
    IMAGO_FORMAT: formatOf(project),
    IMAGO_BRIEF_TITLE: String(project.brief?.title ?? project.title ?? "").slice(0, 300),
    IMAGO_CONCEPT_SET: typeof project.conceptSet?.id === "string" ? project.conceptSet.id : "",
  };
  // The MCP process is spawned by Claude with a trimmed environment; it needs the display hints.
  for (const key of ["DISPLAY", "WAYLAND_DISPLAY", "LD_LIBRARY_PATH", "HOME"]) if (process.env[key]) env[key] = process.env[key];
  return { mcpServers: { imago: { command: process.execPath, args: [config.mcpScript], env } } };
}

let seriesPrompt;
const seriesText = () =>
  (seriesPrompt ??= readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "presets", "series.md"), "utf8").trim());

/** The "Series style" section for a project in a series that has a style reference, else "". */
export async function seriesSection(config, project, projectDir) {
  if (typeof project.series !== "string" || !project.series) return "";
  const present = await access(path.join(projectDir, "reference", "style-reference.html")).then(() => true, () => false);
  if (!present) return "";
  const name = (await readSeriesFile(config.dataDir)).find((s) => s.id === project.series)?.name ?? project.series;
  return seriesText().replaceAll("{{name}}", name.replace(/[\r\n"]+/g, " "));
}

/** The "Brand" section from the project's own snapshot (`reference/brand.json`), "" for a project without one. */
export async function brandSectionFor(projectDir) {
  return brandSection(await readSnapshot(projectDir));
}

/** The text appended to Claude's system prompt for a turn: the series section, the brand section, "further", then the concept. */
export function systemPromptFor(config, project, run = resolveRun(config), series = "", concept = null, brand = "") {
  let system = buildSystemPrompt(project, fontFamilies(config.fontsDir));
  if (series) system = `${system}\n\n${series}`;
  if (brand) system = `${system}\n\n${brand}`;
  if (run.mode === "further") system = `${system}\n\n${furtherText()}`;
  // A concept-set turn: its own concept and the others, appended last.
  return concept ? `${system}\n\n${conceptSection(concept.concept, concept.siblings ?? [])}` : system;
}

/** The "From the video" text for a project imported from a kit, "" otherwise. Read from the project's own copy of kit.json. */
export async function kitTextFor(config, project, projectDir) {
  if (!project.kit) return "";
  try {
    const kit = JSON.parse(await readFile(path.join(projectDir, "reference", "kit.json"), "utf8"));
    const names = Object.fromEntries(project.assets.filter((a) => a.kitFile).map((a) => [a.kitFile, a.name]));
    const contactSheet = project.assets.some((a) => a.name === "kit-contact-sheet.png");
    const grades = Object.fromEntries(project.assets.filter((a) => a.kitFile && a.quality?.grade).map((a) => [a.kitFile, a.quality.grade]));
    return kitPromptSection(kit, { contactSheet, fonts: fontFamilies(config.fontsDir), names, faceSource: project.brief?.faceSource, grades });
  } catch {
    return "";
  }
}

/** The `claude -p` arguments. `systemFile` is a file holding the system prompt (kept off the command line). */
export function buildArgs(config, project, projectDir, run = resolveRun(config), systemFile = "<system-prompt-file>") {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--model", run.model,
    "--effort", run.effort,
    // Confines the file tools to the project folder, drops code-running tools and ignores settings files.
    "--restricted",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify(mcpConfig(config, project, projectDir)),
    "--tools", run.tools,
    // Nothing may prompt: anything not allowed below is denied.
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--disable-slash-commands",
    "--allowedTools", run.allowed,
    "--disallowedTools", run.disallowed,
    "--append-system-prompt-file", systemFile,
  ];
  if (project.sessionId) args.push("--resume", project.sessionId);
  return args;
}

const RECAP_MESSAGES = 10;
const RECAP_CHARS = 500;

/** First-turn style prompt for a project whose Claude session is gone: brief, a short recap, then the request. */
export function buildRecoveryPrompt(project, history, userText, designExists, duplicate = false, kitText = "") {
  const recap = history
    .slice(-RECAP_MESSAGES)
    .map((m) => `${m.role === "user" ? "Owner" : "You"}: ${String(m.text).replace(/\s+/g, " ").trim().slice(0, RECAP_CHARS)}`)
    .join("\n");
  const parts = [
    duplicate
      ? "(This project is a duplicate of an earlier one, so you have no memory of working on it. Here is where things stand.)"
      : "(Your earlier conversation about this project is no longer available, so here is where things stand.)",
  ];
  if (recap) parts.push(`Earlier messages, oldest first:\n${recap}`);
  if (designExists) {
    parts.push(
      duplicate
        ? "design.html already holds the duplicated design: Read it first and edit it rather than starting over."
        : "design.html already exists in this folder with the current design: Read it first and edit it rather than starting over.",
    );
  }
  return `${buildFirstPrompt(project, parts.join("\n\n"), kitText)}\n\n${userText}`.trim();
}

const NO_SESSION = /No conversation found|session/i;

const SIGNED_OUT_FAILURE = { code: "CLAUDE_SIGNED_OUT", message: "Claude Code is not signed in. Run `claude` in a terminal and sign in." };

/**
 * One turn = one `claude -p` run (plus one fresh retry when a resumed session is gone). Streams
 * stream-json into events (via `emit`) and project.json. Never throws: every failure becomes a
 * `run.error`, and `running` is always cleared.
 */
export async function runTurn(options) {
  const { store, id, emit } = options;
  try {
    return await runTurnInner(options);
  } catch (error) {
    const failure = { code: "EXITED", message: String(error?.message ?? error) };
    emit("run.error", failure);
    return { ok: false, failure };
  } finally {
    await store.mutate(id, (p) => void (p.running = false)).catch(() => {});
  }
}

async function runTurnInner({ config, store, id, text, mode = "standard", modelKey = "opus", emit, signal, release, concept = null }) {
  const run = resolveRun(config, mode, modelKey);
  const projectDir = store.dirOf(id);
  const startedAt = Date.now();
  let project = await store.mutate(id, (p) => {
    p.running = true;
    p.messages.push({ role: "user", text, at: new Date().toISOString(), version: null, mode: run.mode, model: run.model });
  });
  const history = project.messages.slice(0, -1);
  emit("run.started", { at: new Date().toISOString(), mode: run.mode, model: run.model });
  emit("project", { project });

  const toolNames = new Map(); // tool_use id -> name
  const renderCalls = new Set();
  const assetCalls = new Map(); // id -> tool name
  let lastVersion = null;
  let lastAssistant = -1;

  /** Runs `claude` once and reports what it did. */
  async function attempt(prompt, resuming) {
    const seen = { init: false, assistant: false, result: null };
    let chain = Promise.resolve();
    const handle = async (ev) => {
      if (ev.kind === "init" && ev.sessionId) {
        seen.init = true;
        // The brief has been delivered once claude has started a session.
        project = await store.mutate(id, (p) => {
          p.sessionId = ev.sessionId;
          p.briefSent = true;
        });
      } else if (ev.kind === "text") {
        seen.assistant = true;
        project = await store.mutate(id, (p) => {
          p.messages.push({ role: "assistant", text: ev.text, at: new Date().toISOString(), version: null, mode: run.mode, model: run.model });
          lastAssistant = p.messages.length - 1;
        });
        emit("assistant.text", { text: ev.text });
        emit("project", { project });
      } else if (ev.kind === "tool_use") {
        seen.assistant = true;
        toolNames.set(ev.id, ev.name);
        if (ev.name === "mcp__imago__render") renderCalls.add(ev.id);
        if (["mcp__imago__cut_out", "mcp__imago__fetch_image", "mcp__imago__use_face"].includes(ev.name)) assetCalls.set(ev.id, ev.name);
        emit("tool.use", { name: ev.name, summary: summarizeTool(ev.name, ev.input) });
      } else if (ev.kind === "tool_result") {
        if (renderCalls.delete(ev.toolUseId) && !ev.isError) {
          const n = await highestVersion(projectDir);
          if (n >= 1) {
            let warnings = [];
            let checks = [];
            try {
              const reply = JSON.parse(ev.text);
              warnings = reply.warnings ?? [];
              checks = Array.isArray(reply.checks) ? reply.checks : [];
            } catch {
              // The version still counts without its warnings.
            }
            lastVersion = n;
            project = await store.mutate(id, (p) => {
              if (!p.versions.some((v) => v.n === n)) p.versions.push({ n, at: new Date().toISOString(), warnings, ...(checks.length ? { checks } : {}) });
              p.current = n;
            });
            const feed = await access(path.join(projectDir, "renders", `v${n}-feed.png`)).then(() => `/projects/${id}/renders/v${n}-feed.png`, () => null);
            emit("render.done", { version: n, url: `/projects/${id}/renders/v${n}.png`, warnings, checks, feedUrl: feed });
            emit("project", { project });
          }
        } else if (assetCalls.has(ev.toolUseId)) {
          const tool = assetCalls.get(ev.toolUseId);
          assetCalls.delete(ev.toolUseId);
          if (!ev.isError) {
            if (tool === "mcp__imago__cut_out") {
              try {
                const made = JSON.parse(ev.text);
                if (made?.name && made?.from) await registerCutout(store, id, made);
              } catch {
                // syncAssets below still picks the file up.
              }
            }
            if ((await syncAssets(store, id)).length || tool === "mcp__imago__cut_out") emit("project", { project: await store.read(id) });
          }
        }
        const name = toolNames.get(ev.toolUseId);
        if (name) {
          toolNames.delete(ev.toolUseId);
          emit("tool.done", { name, ok: !ev.isError });
        }
      } else if (ev.kind === "result") {
        seen.result = ev;
        if (ev.sessionId) {
          project = await store.mutate(id, (p) => {
            p.sessionId = ev.sessionId;
            p.briefSent = true;
          });
        }
      }
    };
    const onLine = (line) => {
      for (const ev of interpretLine(line)) chain = chain.then(() => handle(ev)).catch(() => {});
    };

    await installCraft(project, projectDir).catch(() => {}); // best effort: a turn without the craft files still works
    // The system prompt goes in a file outside the project (so it is not on the command line, and
    // Claude cannot read it back through its file tools); it is removed as soon as the turn ends.
    const promptDir = await mkdtemp(path.join(os.tmpdir(), "imago-prompt-"));
    const promptFile = path.join(promptDir, "system.md");
    try {
      await writeFile(promptFile, systemPromptFor(config, project, run, await seriesSection(config, project, projectDir), concept, await brandSectionFor(projectDir)), { mode: 0o600 });
      // A further turn renders more and may fetch images, so it gets twice the time.
      const timeoutMs = run.mode === "further" ? config.turnTimeoutMs * 2 : config.turnTimeoutMs;
      let outcome;
      try {
        outcome = await runProcess({
          binary: config.claudeBin,
          args: buildArgs(config, project, projectDir, run, promptFile),
          cwd: projectDir,
          stdin: prompt,
          env: electronEnv(config),
          timeoutMs,
          signal,
          onStdoutLine: onLine,
        });
      } catch (error) {
        outcome = { spawnError: error instanceof SpawnError ? error : new SpawnError(config.claudeBin, error) };
      }
      await chain;
      return { outcome, seen, timeoutMs, resuming };
    } finally {
      await rm(promptDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const failureOf = ({ outcome, seen, timeoutMs }) => {
    const { result } = seen;
    if (outcome.spawnError) return { code: "CLAUDE_MISSING", message: `Claude Code could not be started (${config.claudeBin}). Install it and restart Imago.` };
    if (outcome.aborted) return { code: "CANCELLED", message: "The turn was cancelled." };
    if (outcome.timedOut) return { code: "TIMEOUT", message: `Claude did not finish within ${Math.round(timeoutMs / 1000)} seconds.` };
    if (result?.isError) return SIGNED_OUT.test(result.text) ? SIGNED_OUT_FAILURE : { code: "EXITED", message: result.text || "Claude reported an error." };
    if (!result) {
      if (SIGNED_OUT.test(outcome.stderr)) return SIGNED_OUT_FAILURE;
      return { code: "EXITED", message: `Claude exited${outcome.code === null ? "" : ` with code ${outcome.code}`} without an answer. ${outcome.stderr.slice(-400)}`.trim() };
    }
    return null;
  };

  // The brief goes in until claude has started a session once (`briefSent`), not merely on message one.
  const needsBrief = project.briefSent !== true && !project.sessionId;
  // A duplicate has history and a design but no session: brief it like a recovered session, with the note that design.html holds the copy.
  const duplicated = needsBrief && Boolean(project.duplicatedFrom);
  const designNow = () => access(path.join(projectDir, "design.html")).then(() => true, () => false);
  const kitText = needsBrief ? await kitTextFor(config, project, projectDir) : "";
  const opening = duplicated ? buildRecoveryPrompt(project, history, text, await designNow(), true, kitText) : needsBrief ? buildFirstPrompt(project, text, kitText) : text;
  let first = await attempt(opening, Boolean(project.sessionId));
  let failure = failureOf(first);

  // A stored session that claude no longer has fails every resume. Forget it and start fresh once.
  const gone = (a) =>
    a.resuming &&
    failure &&
    ["EXITED"].includes(failure.code) &&
    (!a.seen.init || !a.seen.assistant || NO_SESSION.test(`${failure.message}\n${a.outcome.stderr ?? ""}`));
  if (gone(first)) {
    project = await store.mutate(id, (p) => {
      p.sessionId = null;
      p.briefSent = false;
    });
    const designExists = await access(path.join(projectDir, "design.html")).then(() => true, () => false);
    first = await attempt(buildRecoveryPrompt(project, history, text, designExists, false, await kitTextFor(config, project, projectDir)), false);
    failure = failureOf(first);
  }
  const { seen } = first;

  await syncAssets(store, id).catch(() => {});
  project = await store.mutate(id, (p) => {
    p.running = false;
    if (lastVersion && lastAssistant >= 0 && p.messages[lastAssistant]) p.messages[lastAssistant].version = lastVersion;
  });
  emit("project", { project });
  release?.(); // the project is idle now: whoever sees the closing event may export or send again
  if (failure) emit("run.error", failure);
  else emit("run.finished", { ok: true, costUsd: seen.result?.costUsd ?? 0, durationMs: seen.result?.durationMs || Date.now() - startedAt });
  return { ok: !failure, failure, costUsd: seen.result?.costUsd ?? 0 };
}

// ---- the concept planner: one locked-down turn per set, in the set's own folder ------------------

// Reads the kit material and the craft files, writes one file. No render, no cut_out, no network.
const PLANNER_TOOLS = "Read,Write,Glob";
// File-write permission rules are matched as Edit(...), which also governs the Write tool; a Write(...)
// path rule is not honoured, so the one writable file is granted as Edit and the rest denied the same way.
const PLANNER_ALLOWED = "Read(./**),Glob(./**),Edit(./concepts.json)";
const PLANNER_DISALLOWED = `Bash,WebFetch,WebSearch,Task,NotebookEdit,${["./assets/**", "./reference/**", "./exports/**"].map((p) => `Edit(${p})`).join(",")}`;

/** The planner's `claude -p` arguments: as locked down as a design turn, with no MCP tools at all. */
export function buildPlannerArgs(config, systemFile = "<system-prompt-file>") {
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--model", config.model,
    "--effort", config.effort,
    "--restricted",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--tools", PLANNER_TOOLS,
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--disable-slash-commands",
    "--allowedTools", PLANNER_ALLOWED,
    "--disallowedTools", PLANNER_DISALLOWED,
    "--append-system-prompt-file", systemFile,
  ];
}

/**
 * Runs the planning turn in `dir` (a folder with the kit's assets, the contact sheet and nothing of any
 * concept project) and leaves `concepts.json` there. Never throws; its session is never resumed.
 */
export async function runPlanner({ config, dir, prompt, count, format, brand = null, signal, onTool }) {
  const promptDir = await mkdtemp(path.join(os.tmpdir(), "imago-prompt-"));
  const promptFile = path.join(promptDir, "system.md");
  const seen = { result: null };
  let chain = Promise.resolve();
  try {
    await installCraft({ preset: "thumbnail" }, dir).catch(() => {});
    await writeFile(promptFile, plannerSection({ count, format, brand }), { mode: 0o600 });
    let outcome;
    try {
      outcome = await runProcess({
        binary: config.claudeBin,
        args: buildPlannerArgs(config, promptFile),
        cwd: dir,
        stdin: prompt,
        env: electronEnv(config),
        timeoutMs: config.turnTimeoutMs,
        signal,
        onStdoutLine: (line) => {
          for (const ev of interpretLine(line)) {
            if (ev.kind === "result") seen.result = ev;
            else if (ev.kind === "tool_use" && onTool) chain = chain.then(() => onTool(summarizeTool(ev.name, ev.input))).catch(() => {});
          }
        },
      });
    } catch (error) {
      outcome = { spawnError: error instanceof SpawnError ? error : new SpawnError(config.claudeBin, error) };
    }
    await chain;
    const costUsd = seen.result?.costUsd ?? 0;
    const { result } = seen;
    if (outcome.spawnError) return { ok: false, costUsd, failure: { code: "CLAUDE_MISSING", message: `Claude Code could not be started (${config.claudeBin}).` } };
    if (outcome.aborted) return { ok: false, costUsd, failure: { code: "CANCELLED", message: "The planning turn was cancelled." } };
    if (outcome.timedOut) return { ok: false, costUsd, failure: { code: "TIMEOUT", message: `Planning did not finish within ${Math.round(config.turnTimeoutMs / 1000)} seconds.` } };
    if (result?.isError) return { ok: false, costUsd, failure: SIGNED_OUT.test(result.text) ? SIGNED_OUT_FAILURE : { code: "EXITED", message: result.text || "Claude reported an error." } };
    if (!result) return { ok: false, costUsd, failure: SIGNED_OUT.test(outcome.stderr) ? SIGNED_OUT_FAILURE : { code: "EXITED", message: `Claude exited without an answer. ${outcome.stderr.slice(-300)}`.trim() } };
    return { ok: true, costUsd };
  } finally {
    await rm(promptDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- the face classifier: one locked-down turn per batch, in a folder holding only that batch ------

// Reads the batch's images and contact sheet, writes one file. No MCP, no render, no network.
const FACES_TOOLS = "Read,Write,Glob";
const FACES_ALLOWED = "Read(./**),Glob(./**),Edit(./labels.json)";
const FACES_DISALLOWED = `Bash,WebFetch,WebSearch,Task,NotebookEdit,${["./images/**", "./sheet.png"].map((p) => `Edit(${p})`).join(",")}`;

/** The classifier's `claude -p` arguments: the planner's lock-down on the faces model at low effort. */
export function buildFacesArgs(config, systemFile = "<system-prompt-file>") {
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--model", config.facesModel,
    "--effort", config.facesEffort,
    "--restricted",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--tools", FACES_TOOLS,
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--disable-slash-commands",
    "--allowedTools", FACES_ALLOWED,
    "--disallowedTools", FACES_DISALLOWED,
    "--append-system-prompt-file", systemFile,
  ];
}

/** Runs the classification turn in `dir` (images/, sheet.png) and leaves labels.json there. Never throws, never resumes. */
export async function runFacesClassifier({ config, dir, count, signal }) {
  const promptDir = await mkdtemp(path.join(os.tmpdir(), "imago-prompt-"));
  const promptFile = path.join(promptDir, "system.md");
  const seen = { result: null };
  try {
    await writeFile(promptFile, facesClassifySection({ count }), { mode: 0o600 });
    const prompt = `Label the ${count} photo${count === 1 ? "" : "s"} in images/ (sheet.png is the numbered contact sheet when it exists) and write labels.json.`;
    let outcome;
    try {
      outcome = await runProcess({
        binary: config.claudeBin,
        args: buildFacesArgs(config, promptFile),
        cwd: dir,
        stdin: prompt,
        env: electronEnv(config),
        timeoutMs: config.turnTimeoutMs,
        signal,
        onStdoutLine: (line) => {
          for (const ev of interpretLine(line)) if (ev.kind === "result") seen.result = ev;
        },
      });
    } catch (error) {
      outcome = { spawnError: error instanceof SpawnError ? error : new SpawnError(config.claudeBin, error) };
    }
    const costUsd = seen.result?.costUsd ?? 0;
    const { result } = seen;
    if (outcome.spawnError) return { ok: false, costUsd, failure: { code: "CLAUDE_MISSING", message: "Claude Code could not be started." } };
    if (outcome.aborted) return { ok: false, costUsd, failure: { code: "CANCELLED", message: "Classification was cancelled." } };
    if (outcome.timedOut) return { ok: false, costUsd, failure: { code: "TIMEOUT", message: `Classification did not finish within ${Math.round(config.turnTimeoutMs / 1000)} seconds.` } };
    if (result?.isError) return { ok: false, costUsd, failure: SIGNED_OUT.test(result.text) ? SIGNED_OUT_FAILURE : { code: "EXITED", message: result.text || "Claude reported an error." } };
    if (!result) return { ok: false, costUsd, failure: SIGNED_OUT.test(outcome.stderr) ? SIGNED_OUT_FAILURE : { code: "EXITED", message: `Claude exited without an answer. ${outcome.stderr.slice(-300)}`.trim() } };
    return { ok: true, costUsd };
  } finally {
    await rm(promptDir, { recursive: true, force: true }).catch(() => {});
  }
}
