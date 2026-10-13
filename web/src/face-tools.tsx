// What the owner can do about a design's faces and finished files without typing to Claude: refresh a face the pack has
// improved, try other faces, update a face everywhere it is used, and download what was exported.
import { useEffect, useState } from "react";
import { api } from "./api/index.js";
import type { ExportFile, FaceUsage, FaceView, Project } from "./api/types.js";
import { Btn, Spinner } from "./components.js";
import { Dialog } from "./library/ui.js";
import { useToast } from "./library/hooks.js";
import { download, errorText, hasPackFace, mb, navigate } from "./lib.js";

/** "The face pack has a newer copy": shown when a face in this design was re-retouched (or changed) after it was copied in. */
export function RefreshFacesBar({ project, running, onProject }: { project: Project; running: boolean; onProject: (p: Project) => void }) {
  const [stale, setStale] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const withFace = hasPackFace(project);
  useEffect(() => {
    if (!withFace || running) return;
    let live = true;
    api.faceStatus(project.id).then((s) => live && setStale(s.stale), () => {});
    return () => {
      live = false;
    };
  }, [project.id, project.updatedAt, project.current, running, withFace]);
  if (!withFace || running || (stale === 0 && !note)) return null;
  async function refresh() {
    setBusy(true);
    setNote("");
    try {
      const r = await api.refreshFaces(project.id);
      onProject(r.project);
      setStale(0);
      setNote(`Version ${r.version} has the newer ${r.refreshed.length > 1 ? "faces" : "face"}.${r.skipped.length ? ` Left as they were: ${r.skipped.map((s) => s.name).join(", ")}.` : ""}`);
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="refresh-bar" role="status">
      <span className="small">
        {stale > 0 ? `Your face pack has a newer copy of ${stale > 1 ? `${stale} faces` : "a face"} in this design (re-retouched or changed).` : note}
      </span>
      {stale > 0 && (
        <>
          <Btn variant="primary" icon="refresh" size={18} disabled={busy} onClick={() => void refresh()} title="Copies the face again and renders a new version. Claude is not involved and nothing else changes.">
            {busy ? "Refreshing…" : "Refresh faces"}
          </Btn>
          {busy && <Spinner />}
          {note && <span className="small field-error">{note}</span>}
        </>
      )}
    </div>
  );
}

/** "Try other faces": the same design with a different pack face each, side by side on the compare screen. */
export function TryFacesDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [mode, setMode] = useState<"auto" | "pick">("auto");
  const [count, setCount] = useState(3);
  const [chosen, setChosen] = useState<string[]>([]);
  const [faces, setFaces] = useState<FaceView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = new Set(project.assets.filter((a) => a.kind === "face").map((a) => a.faceId));
  useEffect(() => {
    api.listFaces().then((l) => setFaces(l.items.filter((f) => f.stage === "ready" && !f.hidden && !current.has(f.id)))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const n = mode === "auto" ? count : chosen.length;
  const ok = !busy && n > 0 && faces.length > 0;
  async function go() {
    setBusy(true);
    setError("");
    try {
      const set = await api.faceVariants(project.id, mode === "auto" ? { count } : { faces: chosen });
      onClose();
      navigate(`/c/${set.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 6 ? [...c, id] : c));
  return (
    <Dialog title="Try other faces" onClose={onClose}>
      <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); if (ok) void go(); }}>
        <p className="muted small">
          Copies this design once per face and changes only the face on each copy, side by side on the compare screen. Each one is a short Claude turn, and this design stays as it is.
          You pick one; it is starred and the others stay in your library.
        </p>
        <div className="seg" role="radiogroup" aria-label="Which faces">
          <button type="button" role="radio" aria-checked={mode === "auto"} className={mode === "auto" ? "on" : ""} onClick={() => setMode("auto")}>Pick for me</button>
          <button type="button" role="radio" aria-checked={mode === "pick"} className={mode === "pick" ? "on" : ""} onClick={() => setMode("pick")}>I'll choose</button>
        </div>
        {mode === "auto" ? (
          <label className="field">
            <span className="label">How many <em>different expressions, best quality first</em></span>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[2, 3, 4, 5, 6].map((c) => <option key={c} value={c}>{c} faces</option>)}
            </select>
          </label>
        ) : (
          <ul className="face-pick" aria-label="Faces from your pack">
            {faces.map((f) => (
              <li key={f.id}>
                <button type="button" className={`face-pick-item ${chosen.includes(f.id) ? "on" : ""}`} aria-pressed={chosen.includes(f.id)} onClick={() => toggle(f.id)} title={f.labels?.description}>
                  <img src={f.retouch.thumbUrl ?? f.cutout.thumbUrl ?? ""} alt="" />
                  <span className="small">{f.labels?.expression ?? "?"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {faces.length === 0 && <p className="muted small">The pack has no other ready face to try.</p>}
        {error && <p className="banner-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={!ok}>{busy ? "Starting…" : `Try ${n || ""} ${n === 1 ? "face" : "faces"}`}</Btn>
        </div>
      </form>
    </Dialog>
  );
}

/** In a face's edit dialog: the designs that hold a copy of it, and a button to update the old ones. */
export function FaceUsagePanel({ faceId }: { faceId: string }) {
  const toast = useToast();
  const [usage, setUsage] = useState<FaceUsage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.faceUsage(faceId).then(setUsage, () => setUsage([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceId]);
  if (!usage?.length) return null;
  const stale = usage.filter((u) => u.stale);
  async function update() {
    setBusy(true);
    try {
      const { results } = await api.refreshFaceEverywhere(faceId);
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      toast(`Updated ${ok} ${ok === 1 ? "design" : "designs"}${failed.length ? `; ${failed.length} could not be (${failed[0]!.error})` : ""}.`);
      await load();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="face-usage">
      <legend>In your designs</legend>
      <p className="small">
        Used in {usage.length} {usage.length === 1 ? "design" : "designs"}
        {stale.length ? `, ${stale.length} with an older copy.` : ", all up to date."}
      </p>
      <Btn icon="refresh" size={18} disabled={busy || stale.length === 0} onClick={() => void update()} title="Copies this face again into every design that holds an older copy and renders a new version of each, with no Claude turn">
        {busy ? "Updating…" : "Update in projects that use this face"}
      </Btn>
    </fieldset>
  );
}

/** A disclosure listing a project's finished files, each with a download button, so the file system is never needed. */
export function ExportsList({ projectId, tick }: { projectId: string; tick: number }) {
  const toast = useToast();
  const [items, setItems] = useState<ExportFile[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api.listExports(projectId).then((l) => live && setItems(l), () => {});
    return () => {
      live = false;
    };
  }, [projectId, tick, version]);
  if (!items.length) return null;
  return (
    <details className="credits exports-list">
      <summary className="small muted">Exports ({items.length})</summary>
      <ul className="small">
        {items.map((f) => (
          <li key={f.name}>
            <span className="mono">{f.name}</span> <span className="muted mono">{mb(f.bytes)} · {new Date(f.at).toLocaleString()}</span>{" "}
            <button type="button" className="btn btn-ghost export-dl" onClick={() => download(f.url, f.name)}>Download</button>
            <button
              type="button"
              className="btn btn-ghost export-rm"
              onClick={() => void api.deleteExport(projectId, f.name).then(() => setVersion((v) => v + 1), (e) => toast(errorText(e)))}
              aria-label={`Delete ${f.name}`}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
