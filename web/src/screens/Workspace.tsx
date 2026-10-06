import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/index.js";
import type { ExportFormat, FurtherModel, Message, PresetInfo, Project, ServerEvent, TurnMode } from "../api/types.js";
import { Icon } from "../brand/Icon.js";
import { Btn, Spinner } from "../components.js";
import { useDeleteWithUndo, useSeries, useToast } from "../library/hooks.js";
import { Glyph, MenuButton, SeriesDialog } from "../library/ui.js";
import { RenameInput } from "./Library.js";
import { Credits, FurtherBar, ModelBadge } from "../further.js";
import { creditLine } from "../further-lib.js";
import { errorText, fmtSize, navigate, runErrorText } from "../lib.js";
import { EXPORT_FORMATS, EXPORT_SCALES, YOUTUBE_MOBILE_MAX_BYTES, allowedScales, presetUi } from "../presets.js";

interface LiveItem {
  kind: "tool" | "text";
  text: string;
}
interface Run {
  running: boolean;
  items: LiveItem[];
  error: string;
  detail: string; // the server's own words for the error, when they add something
  draft: number; // bumps each time design.html is written; 0 = nothing drafted this turn
  turn: { costUsd: number; durationMs: number } | null;
}
const IDLE: Run = { running: false, items: [], error: "", detail: "", draft: 0, turn: null };

export function Workspace({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState("");
  const [run, setRun] = useState<Run>(IDLE);
  const [presets, setPresets] = useState<PresetInfo[]>([]);

  const reload = useCallback(() => {
    api.getProject(id).then(setProject).catch(() => {});
  }, [id]);

  useEffect(() => {
    api.getProject(id).then(setProject).catch((e) => setMissing(errorText(e)));
    api.presets().then(setPresets).catch(() => {});
  }, [id]);

  useEffect(() => {
    const onEvent = (e: ServerEvent) => {
      switch (e.type) {
        case "snapshot":
          setProject(e.project);
          // After a reconnect nothing is live unless the server says so: drop stale lines and errors.
          setRun((r) => (e.project.running ? { ...r, running: true } : { ...r, running: false, items: [], draft: 0, error: "", detail: "" }));
          break;
        case "project":
          setProject(e.project);
          setRun((r) =>
            e.project.running
              ? r.running ? r : { ...r, running: true }
              : r.running || r.items.length || r.draft ? { ...r, running: false, items: [], draft: 0 } : r,
          );
          break;
        case "run.started":
          setRun({ ...IDLE, running: true, turn: null });
          break;
        case "assistant.text":
          setRun((r) => ({ ...r, items: [...r.items, { kind: "text", text: e.text }] }));
          break;
        case "tool.use":
          setRun((r) => ({ ...r, items: [...r.items, { kind: "tool", text: e.summary }] }));
          break;
        case "tool.done":
          // design.html has changed on disk only once a Write or Edit has finished.
          if (e.ok && (e.name === "Write" || e.name === "Edit")) setRun((r) => ({ ...r, draft: r.draft + 1 }));
          break;
        case "render.done":
          setRun((r) => ({ ...r, draft: 0 }));
          setProject((p) =>
            p && !p.versions.some((v) => v.n === e.version)
              ? { ...p, current: e.version, versions: [...p.versions, { n: e.version, at: new Date().toISOString(), warnings: e.warnings }] }
              : p && { ...p, current: e.version },
          );
          break;
        case "run.finished":
          setRun((r) => ({ ...r, running: false, items: [], draft: 0, turn: { costUsd: e.costUsd, durationMs: e.durationMs } }));
          reload();
          break;
        case "run.error":
          setRun((r) => ({ ...r, running: false, items: [], draft: 0, error: runErrorText(e.code, e.message).text, detail: runErrorText(e.code, e.message).detail }));
          reload();
          break;
      }
    };
    return api.subscribe(id, onEvent);
  }, [id, reload]);

  if (missing) {
    return (
      <div className="page">
        <p className="banner-error" role="alert">{missing}</p>
        <Btn onClick={() => navigate("/")}>Back to start</Btn>
      </div>
    );
  }
  if (!project) return <div className="page muted">Opening…</div>;

  const chips = presets.find((p) => p.id === project.preset)?.chips ?? presetUi(project.preset).chips;
  return (
    <div className="workspace">
      <section className="stage-col" aria-label="Preview">
        <Toolbar project={project} run={run} onProject={setProject} />
        <Preview project={project} run={run} />
        <Credits project={project} />
        <VersionStrip project={project} disabled={run.running} onRestore={(n) => api.restore(id, n).then(setProject).catch((e) => setRun((r) => ({ ...r, error: errorText(e), detail: "" })))} />
      </section>
      <Chat
        project={project}
        run={run}
        chips={chips}
        onSend={async (text, opts) => {
          setRun((r) => ({ ...r, error: "", detail: "", turn: null }));
          try {
            await api.sendMessage(id, text, opts);
          } catch (e) {
            setRun((r) => ({ ...r, error: errorText(e), detail: "" }));
            throw e;
          }
        }}
        onStop={() => api.cancel(id).catch(() => {})}
      />
    </div>
  );
}

function Toolbar({ project, run, onProject }: { project: Project; run: Run; onProject: (p: Project) => void }) {
  const toast = useToast();
  const { series, refresh } = useSeries();
  const deleteWithUndo = useDeleteWithUndo();
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const seriesName = project.series ? series.find((s) => s.id === project.series)?.name : undefined;

  const patch = (change: { title?: string; starred?: boolean; series?: string | null }) =>
    api.patchProject(project.id, change).then(onProject).catch((e) => toast(errorText(e)));
  function finishRename(title: string | null) {
    setRenaming(false);
    const next = title?.trim();
    if (next && next !== project.title) void patch({ title: next });
  }

  const items = [
    { label: "Rename", onSelect: () => setRenaming(true) },
    { label: project.starred ? "Remove star" : "Star", onSelect: () => void patch({ starred: !project.starred }) },
    {
      label: "Duplicate",
      disabled: run.running,
      onSelect: () =>
        void api.duplicateProject(project.id).then(
          (copy) => {
            navigate(`/p/${copy.id}`);
            toast(`Made "${copy.title}". Claude starts a fresh conversation, with the design already in place.`);
          },
          (e) => toast(errorText(e)),
        ),
    },
    { label: "New in this style", disabled: !project.current, onSelect: () => navigate(`/new/${project.preset}?style=${encodeURIComponent(project.id)}`) },
    { label: "Move to series…", onSelect: () => setMoving(true) },
    {
      label: "Delete",
      danger: true,
      divider: true,
      disabled: run.running,
      onSelect: () =>
        void deleteWithUndo([project.id], (undone) => (undone ? navigate(`/p/${project.id}`) : navigate("/library")), project.title).catch((e) => toast(errorText(e))),
    },
  ];

  return (
    <div className="toolbar">
      <div className="toolbar-title">
        {renaming ? (
          <RenameInput title={project.title} className="lib-rename toolbar-rename" onDone={finishRename} />
        ) : (
          <h1 className="display" title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>{project.title}</h1>
        )}
        <span className="mono muted small">
          {fmtSize(project.size)}{project.current ? ` · v${project.current}` : ""}
        </span>
        {seriesName && <span className="series-chip static">{seriesName}</span>}
      </div>
      <div className="toolbar-actions">
        <button type="button" className={`icon-btn star-btn ${project.starred ? "on" : ""}`} aria-pressed={project.starred === true} aria-label={project.starred ? "Remove star" : "Star this design"} onClick={() => void patch({ starred: !project.starred })}>
          <Glyph name={project.starred ? "star-fill" : "star"} size={22} />
        </button>
        <MenuButton label="More actions" items={items} />
        <ExportMenu project={project} disabled={run.running || !project.current} />
      </div>
      {moving && (
        <SeriesDialog
          count={1}
          current={project.series}
          series={series}
          onPick={async (to) => {
            onProject(await api.patchProject(project.id, { series: to }));
            await refresh();
          }}
          onClose={() => setMoving(false)}
        />
      )}
    </div>
  );
}

/** Measures its box so the design can be scaled to fit exactly. */
function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

function Preview({ project, run }: { project: Project; run: Run }) {
  const [ref, box] = useBox();
  const { width, height } = project.size;
  const pad = 24;
  const scale = Math.min(Math.max(box.w - pad * 2, 1) / width, Math.max(box.h - pad * 2, 1) / height);
  const frame = { width: Math.floor(width * scale), height: Math.floor(height * scale) };
  const live = run.running && run.draft > 0;
  const designSrc = useMemo(() => (live ? api.designUrl(project.id, run.draft) : ""), [live, project.id, run.draft]);

  return (
    <div className="preview" ref={ref}>
      <div className="frame" style={box.w ? frame : { visibility: "hidden" }}>
        {live ? (
          // No scripts, ever: the sandbox is empty on purpose.
          <iframe title="Live draft" sandbox="" src={designSrc} style={{ width, height, transform: `scale(${scale})` }} />
        ) : project.current ? (
          <img src={api.renderUrl(project.id, project.current)} alt={`Version ${project.current} of ${project.title}`} />
        ) : (
          <div className="frame-empty">
            {run.running ? <><Spinner /> <span>Claude is getting started…</span></> : <span>Nothing designed yet. Say what you want in the chat.</span>}
          </div>
        )}
        {live && <span className="live-tag"><Spinner /> Live draft</span>}
      </div>
    </div>
  );
}

function VersionStrip({ project, disabled, onRestore }: { project: Project; disabled: boolean; onRestore: (n: number) => void }) {
  if (!project.versions.length) return <div className="versions versions-empty"><Icon name="versions" size={22} /> <span className="muted small">Every render is kept here. Click one to go back to it.</span></div>;
  const ratio = project.size.width / project.size.height;
  return (
    <div className="versions" role="list" aria-label="Versions">
      {project.versions.map((v) => (
        <button
          key={v.n}
          type="button"
          role="listitem"
          className={`version ${v.n === project.current ? "on" : ""}`}
          disabled={disabled}
          onClick={() => v.n !== project.current && onRestore(v.n)}
          aria-current={v.n === project.current}
          title={v.n === project.current ? "Current version" : `Go back to version ${v.n}`}
        >
          <img src={api.renderUrl(project.id, v.n)} alt="" style={{ aspectRatio: String(ratio) }} />
          <span className="mono">v{v.n}</span>
        </button>
      ))}
    </div>
  );
}

function ExportMenu({ project, disabled }: { project: Project; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const thumb = project.preset === "thumbnail";
  // Thumbnails default to YouTube's recommended 4K JPG; everything else to 1x PNG.
  const [format, setFormat] = useState<ExportFormat>(thumb ? "jpg" : "png");
  const [wanted, setScale] = useState<number>(thumb ? 3 : 1);
  const [state, setState] = useState<{ busy: boolean; note: string; bad: boolean; warn?: string }>({ busy: false, note: "", bad: false });
  const box = useRef<HTMLDivElement>(null);
  // Scales whose longest edge stays within 8192 px; the rest would not capture reliably.
  const scales = allowedScales(project.size);
  const scale = scales.includes(wanted) ? wanted : scales.at(-1) ?? 1;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const scaleLabel = (s: number) => (thumb && s === 1.5 ? "1080p" : thumb && s === 3 ? "4K, YouTube's recommended size" : `${s}×`);

  async function go() {
    setState({ busy: true, note: "", bad: false });
    try {
      const r = await api.exportProject(project.id, { format, scale });
      const a = document.createElement("a");
      a.href = r.url;
      a.download = r.name;
      document.body.append(a);
      a.click();
      a.remove();
      const big = thumb && r.bytes > YOUTUBE_MOBILE_MAX_BYTES;
      const warn = big
        ? `Over 2 MB: too big for the YouTube mobile app, fine on desktop (50 MB).${format === "png" ? " Choose JPG for a smaller file." : ""}`
        : undefined;
      setState({ busy: false, note: `${r.name} · ${r.width}×${r.height} · ${(r.bytes / 1024 / 1024).toFixed(2)} MB${r.credits?.length ? ` · ${creditLine(r.credits)}` : ""}`, bad: false, warn });
    } catch (e) {
      setState({ busy: false, note: errorText(e), bad: true });
    }
  }

  return (
    <div className="export" ref={box}>
      <Btn variant="primary" icon="export" disabled={disabled} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        Export
      </Btn>
      {open && (
        <div className="popover" role="dialog" aria-label="Export">
          <span className="label">Format</span>
          <div className="seg" role="radiogroup" aria-label="Format">
            {EXPORT_FORMATS.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={format === f} className={`mono ${format === f ? "on" : ""}`} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
            ))}
          </div>
          <span className="label">Size</span>
          <div className="seg stack" role="radiogroup" aria-label="Scale">
            {EXPORT_SCALES.filter((s) => scales.includes(s)).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scale === s} className={scale === s ? "on" : ""} onClick={() => setScale(s)}>
                <span>{scaleLabel(s)}</span>
                <span className="mono muted">{fmtSize(project.size, s)}</span>
              </button>
            ))}
          </div>
          <Btn variant="primary" icon="export" disabled={state.busy} onClick={go}>{state.busy ? "Exporting…" : "Download"}</Btn>
          {state.note && <p className={`small ${state.bad ? "field-error" : "muted mono"}`} role="status">{state.note}</p>}
          {state.warn && <p className="small field-error" role="status">{state.warn}</p>}
        </div>
      )}
    </div>
  );
}

function Chat({
  project,
  run,
  chips,
  onSend,
  onStop,
}: {
  project: Project;
  run: Run;
  chips: string[];
  onSend: (text: string, opts?: { mode?: TurnMode; model?: FurtherModel }) => Promise<void>;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ text: string; base: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // A sent message shows at once, and gives way once the project itself lists it.
  const shown: Message[] = project.messages;
  const showPending = pending && !shown.slice(pending.base).some((m) => m.role === "user" && m.text === pending.text);
  const liveText = run.items.filter((i) => !(i.kind === "text" && shown.some((m) => m.role === "assistant" && m.text === i.text)));
  const lastTool = [...run.items].reverse().find((i) => i.kind === "tool")?.text;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [shown.length, liveText.length, showPending, run.error, run.detail]);

  async function send(t: string, opts?: { mode?: TurnMode; model?: FurtherModel }) {
    const body = t.trim();
    if ((!body && opts?.mode !== "further") || run.running) return;
    // Without words, "Take it further" shows nothing pending; the server's own direction arrives with the project.
    if (body) setPending({ text: body, base: shown.length });
    setText("");
    try {
      await onSend(body, opts);
    } catch {
      setPending(null);
      setText(body);
    }
  }

  const canChip = !run.running && project.versions.length > 0;
  return (
    <section className="chat" aria-label="Chat">
      <div className="chat-scroll" aria-live="polite">
        {shown.length === 0 && !showPending && !run.running && <p className="muted small">Describe what you want. Claude will design it and show you each version.</p>}
        {shown.map((m, i) => (
          <Bubble key={`${m.at}-${i}`} m={m} />
        ))}
        {showPending && <Bubble m={{ role: "user", text: pending.text, at: "", version: null }} />}
        {liveText.map((it, i) =>
          it.kind === "text" ? (
            <Bubble key={`l${i}`} m={{ role: "assistant", text: it.text, at: "", version: null }} />
          ) : (
            <p key={`l${i}`} className="tool-line"><Icon name="done" size={16} /> {it.text}</p>
          ),
        )}
        {run.error && (
          <p className="banner-error" role="alert">
            <Icon name="alert" size={22} />
            <span>
              {run.error}
              {run.detail && <span className="error-detail small muted mono">{run.detail}</span>}
            </span>
          </p>
        )}
        <div ref={end} />
      </div>

      <div className="chat-foot">
        {run.running ? (
          <div className="status">
            <Spinner />
            <span className="status-text">{lastTool ? `${lastTool}…` : "Thinking…"}</span>
            <Btn variant="danger" icon="stop" size={18} onClick={onStop}>Stop</Btn>
          </div>
        ) : (
          run.turn && (
            <p
              className="turn mono muted small"
              title="Not a charge. Claude Code's estimate of what this turn would cost at API prices: a rough gauge of how much of your subscription's usage it took."
            >
              Last turn {(run.turn.durationMs / 1000).toFixed(0)} s · ≈ ${run.turn.costUsd.toFixed(2)} at API rates
            </p>
          )
        )}
        {canChip && (
          <div className="chips">
            {chips.map((c) => (
              <button key={c} type="button" className="chip" onClick={() => void send(c)}>{c}</button>
            ))}
          </div>
        )}
        {canChip && <FurtherBar hasNote={text.trim().length > 0} disabled={run.running} onGo={(model) => void send(text, { mode: "further", model })} />}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <textarea
            rows={2}
            value={text}
            placeholder={run.running ? "Claude is working…" : project.versions.length ? "Ask for a change…" : "Describe what you want…"}
            aria-label="Message to Claude"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          <Btn type="submit" variant="primary" icon="send" disabled={run.running || !text.trim()} aria-label="Send" />
        </form>
      </div>
    </section>
  );
}

function Bubble({ m }: { m: Message }) {
  return (
    <div className={`bubble ${m.role}`}>
      {m.role === "assistant" && <Icon name="sparkle" size={20} className="bubble-icon" />}
      <p>{m.text}</p>
      {m.mode === "further" && m.model && <ModelBadge model={m.model} />}
      {m.version != null && <span className="mono muted small">v{m.version}</span>}
    </div>
  );
}
