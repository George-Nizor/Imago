import { useEffect, useMemo, useState } from "react";
import { api } from "../api/index.js";
import type { ConceptState, ConceptView, ConceptSetView, QuickExport, SetEvent, ZipExport } from "../api/types.js";
import { Btn, Spinner } from "../components.js";
import { Icon } from "../brand/Icon.js";
import { FeedPreview } from "../feed/FeedPreview.js";
import { decoyNeighbours, surfacesFor, type FeedNeighbour } from "../feed/feed-lib.js";
import { useToast } from "../library/hooks.js";
import { download, errorText, mb, navigate } from "../lib.js";

const STATE_LABEL: Record<ConceptState, string> = {
  planning: "Planning",
  waiting: "Waiting its turn",
  designing: "Designing",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  removed: "Deleted",
};
const ARCHETYPE_NAMES: Record<string, string> = {
  reaction: "Reaction",
  "result-reveal": "Result reveal",
  "before-after": "Before and after",
  versus: "Versus",
  number: "The number",
  "curiosity-gap": "Curiosity gap",
  "object-hero": "Object hero",
  "story-moment": "Story moment",
};
const live = (s: ConceptState) => s === "planning" || s === "waiting" || s === "designing";

export function Compare({ id }: { id: string }) {
  const toast = useToast();
  const [set, setSet] = useState<ConceptSetView | null>(null);
  const [missing, setMissing] = useState("");
  const [progress, setProgress] = useState<Record<number, string>>({});
  const [setNote, setSetNote] = useState("");
  const [surface, setSurface] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [picked, setPicked] = useState<Set<string> | null>(null); // null: the first three that are done
  const [busy, setBusy] = useState("");
  const [exported, setExported] = useState<{ text: string; warn: boolean } | null>(null);

  useEffect(() => {
    api.getConceptSet(id).then(setSet).catch((e) => setMissing(errorText(e)));
    return api.subscribeSet(id, (e: SetEvent) => {
      if (e.type === "snapshot" || e.type === "set") setSet(e.set);
      else if (e.type === "concept.progress") setProgress((p) => ({ ...p, [e.index]: e.text }));
      else setSetNote(e.text);
    });
  }, [id]);

  const format = set?.format ?? "video";
  const surfaces = surfacesFor(format);
  const active = surfaces.some((s) => s.id === surface) ? surface : surfaces[0]!.id;
  const fixedDark = ["shorts", "reels", "tiktok"].includes(active);
  const running = set ? ["planning", "designing"].includes(set.state) : false;

  const ready = useMemo(() => (set?.concepts ?? []).filter((c) => c.state === "done" && c.renderUrl), [set]);
  const chosen = picked ?? new Set(ready.slice(0, 3).map((c) => c.projectId));
  const toggle = (pid: string) => {
    const next = new Set(chosen);
    if (next.has(pid)) next.delete(pid);
    else next.add(pid);
    setPicked(next);
  };

  if (missing) {
    return (
      <div className="page">
        <p className="banner-error" role="alert">{missing}</p>
        <Btn onClick={() => navigate("/library")}>Back to the library</Btn>
      </div>
    );
  }
  if (!set) return <div className="page muted">Opening…</div>;

  async function act<T>(name: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(name);
    setExported(null);
    try {
      after?.(await fn());
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy("");
    }
  }
  const finishQuick = (r: QuickExport) => {
    download(r.url, r.name);
    setExported({ text: `${r.name} · ${r.width}×${r.height} ${mb(r.bytes)} · saved in the project's exports`, warn: r.overBudget });
  };
  const finishExport = (z: ZipExport) => {
    download(z.url, z.name);
    const sizes = z.files.map((f) => `${f.width}×${f.height} ${mb(f.bytes)}`).join(", ");
    setExported({ text: `${z.name} · ${mb(z.bytes)} · ${sizes}`, warn: z.files.some((f) => f.overBudget) });
  };

  return (
    <div className="page compare">
      <a className="back" href="/library" onClick={(e) => { e.preventDefault(); navigate("/library"); }}>← Library</a>
      <div className="compare-head">
        <h1 className="display">{set.title}</h1>
        <span className={`pill pill-${set.state}`}>{running && <Spinner />}{set.state === "draft" ? "Not started" : set.state === "done" ? "Finished" : set.state === "cancelled" ? "Stopped" : set.state === "failed" ? "Failed" : set.state === "planning" ? "Planning" : "Designing"}</span>
        <span className="mono muted small" title="Claude Code's estimate at API prices; not a charge on a subscription.">≈ ${set.costUsd.toFixed(2)} at API rates</span>
      </div>
      <p className="muted small">
        {set.kit ? <>From the Fabula video “{set.kit.title}”. </> : null}
        {set.plan.source === "planner" ? "Claude planned these concepts first, then designed each one." : null}
        {setNote && running ? ` ${setNote}…` : ""}
      </p>
      {set.titles && <p className="muted small">A title A/B test: each thumbnail goes with its own title ({set.titles.map((t) => `“${t}”`).join(", ")}). The Test &amp; Compare files are named after the titles.</p>}
      {set.kind === "faces" && (
        <div className="variants-source">
          {set.source?.renderUrl && <img src={set.source.renderUrl} alt={`The original design, ${set.source.title ?? ""}`} />}
          <p className="muted small">
            The same design with a different face on each copy.{" "}
            {set.picked ? "You picked one: it is starred, and the others are still in your library." : "Pick the one you like: it is starred and the others stay in your library."}
            {set.source && !set.source.removed ? <> The original is untouched (<a href={`/p/${set.source.projectId}`} onClick={(e) => { e.preventDefault(); navigate(`/p/${set.source!.projectId}`); }}>open it</a>).</> : null}
          </p>
        </div>
      )}
      {set.plan.source === "fallback" && <p className="banner-error" role="status"><Icon name="alert" size={22} /><span>{set.plan.note}</span></p>}

      <div className="compare-controls">
        <div className="seg wrap" role="radiogroup" aria-label="Where to compare them">
          {surfaces.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={active === s.id} className={active === s.id ? "on" : ""} onClick={() => setSurface(s.id)}>{s.label}</button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(["dark", "light"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} disabled={fixedDark} onClick={() => setTheme(t)}>{t === "dark" ? "Dark" : "Light"}</button>
          ))}
        </div>
        <div className="compare-actions">
          <Btn icon="sparkle" disabled={running || set.state === "draft" || busy !== "" || set.concepts.length >= 8 || Boolean(set.titles) || set.kind === "faces"}
            title={set.titles ? "A title test has one concept per title" : set.kind === "faces" ? "This set is the same design with other faces" : undefined} onClick={() => void act("another", () => api.anotherConcept(id), setSet)}>
            {busy === "another" ? "Adding…" : "Another concept"}
          </Btn>
          {running && <Btn variant="danger" icon="stop" size={18} onClick={() => void api.cancelConceptSet(id).then(setSet).catch((e) => toast(errorText(e)))}>Cancel</Btn>}
          {set.testCompare && (
            <Btn
              variant="primary"
              icon="export"
              disabled={running || busy !== "" || chosen.size === 0 || chosen.size > 3}
              title="A zip of each chosen concept at 3840×2160, JPG, under 2 MB, ready for YouTube Studio's Test & Compare (desktop, long videos only, up to three)"
              onClick={() => void act("tc", () => api.testCompare(id, [...chosen]), finishExport)}
            >
              {busy === "tc" ? "Exporting…" : "Test & Compare zip"}
            </Btn>
          )}
        </div>
      </div>
      {exported && <p className={`small mono ${exported.warn ? "field-error" : "muted"}`} role="status">{exported.text}{exported.warn ? " · one file is still over 2 MB at the lowest quality" : ""}</p>}
      {set.testCompare && ready.length > 3 && <p className="muted small">YouTube compares at most three thumbnails: tick the ones to include.</p>}
      {!set.testCompare && <p className="muted small">Shorts are not eligible for YouTube's Test &amp; Compare. Download each cover for its platforms from its workspace.</p>}

      <ul className="compare-grid">
        {set.concepts.map((c) => (
          <ConceptCard
            key={c.projectId}
            c={c}
            set={set}
            surface={active}
            theme={fixedDark ? "dark" : theme}
            progress={progress[c.index]}
            included={chosen.has(c.projectId)}
            canInclude={set.testCompare && c.state === "done"}
            onInclude={() => toggle(c.projectId)}
            onExport={() => void act(`export-${c.projectId}`, () => api.quickExport(c.projectId), finishQuick)}
            onPick={() => void act(`pick-${c.projectId}`, () => api.pickConcept(id, c.projectId), (v) => { setSet(v); toast("Starred. The others stay in your library."); })}
            onCovers={() => void act(`covers-${c.projectId}`, () => api.platformExport(c.projectId), finishExport)}
            busy={busy}
          />
        ))}
      </ul>
    </div>
  );
}

function ConceptCard({
  c, set, surface, theme, progress, included, canInclude, onInclude, onCovers, onExport, onPick, busy,
}: {
  c: ConceptView;
  set: ConceptSetView;
  surface: string;
  theme: "dark" | "light";
  progress?: string;
  included: boolean;
  canInclude: boolean;
  onInclude: () => void;
  onCovers: () => void;
  onExport: () => void;
  onPick: () => void;
  busy: string;
}) {
  // In a title test each concept is shown (and judged in the feed) under its own title.
  const title = c.forTitle ?? set.title;
  // The other concepts are the neighbours here: this is the comparison, and stand-ins fill the rest of the feed.
  const neighbours: FeedNeighbour[] = useMemo(() => {
    const siblings = set.concepts.filter((o) => o.projectId !== c.projectId && o.renderUrl).map((o) => ({ src: o.renderUrl!, title: o.forTitle ?? o.label ?? title }));
    const decoys = decoyNeighbours(set.format).map((d) => ({ src: d.src, title: d.title }));
    return [...siblings, ...decoys].slice(0, 7);
  }, [set.concepts, set.format, c.projectId, title]);
  const ratio = set.format === "shorts" ? "9 / 16" : set.format === "podcast" ? "1 / 1" : "16 / 9";
  const label = c.label ?? `Concept ${c.index + 1}`;

  return (
    <li className={`concept-card state-${c.state}`}>
      <div className="concept-top">
        <h2 className="display">{label}</h2>
        <span className={`pill pill-${c.state}`}>{live(c.state) && <Spinner />}{STATE_LABEL[c.state]}</span>
      </div>
      <span className="mono muted small">Concept {c.index + 1}{c.archetype ? ` · ${ARCHETYPE_NAMES[c.archetype] ?? c.archetype}` : ""}</span>
      <div className="concept-image" style={{ aspectRatio: ratio }}>
        {c.renderUrl ? <img src={c.renderUrl} alt={`${label}, version ${c.current}`} /> : <span className="muted small">{c.state === "failed" || c.state === "cancelled" ? "No design" : progress ? `${progress}…` : "Waiting for its first render"}</span>}
      </div>
      {c.forTitle && <p className="small"><strong>For the title.</strong> “{c.forTitle}”</p>}
      {set.kind === "faces" && c.face && <p className="small variant-face"><img src={c.faceThumb ?? ""} alt="" onError={(e) => (e.currentTarget.style.display = "none")} /> <span className="muted">Pack face <span className="mono">{c.face}</span></span></p>}
      {c.idea && <p className="small"><strong>Idea.</strong> {c.idea}</p>}
      {c.why && <p className="small muted"><strong>Why.</strong> {c.why}</p>}
      {c.error && <p className="field-error">{c.error}</p>}
      {c.renderUrl && (
        <div className="concept-feed">
          <FeedPreview src={c.renderUrl} format={set.format} title={title} neighbours={neighbours} theme={theme} surface={surface} />
        </div>
      )}
      {c.renderUrl && (
        <div className="small">
          {c.checks.warn ? <strong>{c.checks.warn} to look at</strong> : <span className="muted">No warnings</span>}
          <span className="muted mono"> · {c.checks.ok} ok · {c.checks.info} notes</span>
          {c.checks.warnings.length > 0 && (
            <ul className="concept-warn">
              {c.checks.warnings.slice(0, 3).map((w) => <li key={w.id}><span className="mono muted">{w.id}</span> {w.message}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="concept-foot">
        {set.kind === "faces" && c.state === "done" && (
          set.picked === c.projectId
            ? <span className="pill pill-done">Picked</span>
            : <Btn variant="primary" icon="done" size={18} disabled={busy !== ""} onClick={onPick} title="Stars this one and keeps the others in your library">{busy === `pick-${c.projectId}` ? "Picking…" : "Pick this one"}</Btn>
        )}
        <Btn variant={set.kind === "faces" ? "ghost" : "primary"} icon="send" size={18} disabled={c.removed} onClick={() => navigate(`/p/${c.projectId}`)}>Refine</Btn>
        {c.state === "done" && c.renderUrl && <Btn icon="export" size={18} disabled={busy !== ""} onClick={onExport} title="Saves the 3× JPG in this concept's project exports and downloads it">{busy === `export-${c.projectId}` ? "Exporting…" : "Export"}</Btn>}
        {set.format === "shorts" && c.state === "done" && <Btn icon="export" size={18} disabled={busy !== ""} onClick={onCovers}>{busy === `covers-${c.projectId}` ? "Exporting…" : "Covers"}</Btn>}
        {canInclude && (
          <label className="include small">
            <input type="checkbox" checked={included} onChange={onInclude} /> Test &amp; Compare
          </label>
        )}
      </div>
    </li>
  );
}
