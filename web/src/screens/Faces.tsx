import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/index.js";
import { EXPRESSIONS, GAZES, GESTURES, HEAD_TURNS, type FaceList, type FaceSettings, type FaceView } from "../api/types.js";
import { Icon } from "../brand/Icon.js";
import { Btn, Spinner } from "../components.js";
import { errorText } from "../lib.js";
import { Dialog, Glyph } from "../library/ui.js";
import { FaceUsagePanel } from "../face-tools.js";
import { useToast } from "../library/hooks.js";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 40 * 1024 * 1024;
const STAGE_TEXT: Record<string, string> = { queued: "Waiting to be cut out", cutting: "Cutting out…", classifying: "Claude is labelling…" };
const retouching = (f: FaceView) => f.retouch.enabled && ["queued", "running"].includes(f.retouch.state);
const percent = (v: number) => `${Math.round(v * 100)}%`;
const GRADE_HELP: Record<string, string> = {
  "4k": "4K: survives a 3× export with the face filling half the canvas",
  hd: "HD: fine at 1080p; at 3× it softens if the face is large",
  soft: "Soft: use small, or pick another",
};
const pretty = (s: string) => s.replace(/-/g, " ");

export function Faces() {
  const toast = useToast();
  const [list, setList] = useState<FaceList | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState("");
  const [expression, setExpression] = useState("");
  const [gesture, setGesture] = useState("");
  const [gaze, setGaze] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => api.listFaces().then((l) => (setList(l), setError(""))).catch((e) => setError(errorText(e))), []);
  useEffect(() => void refresh(), [refresh]);
  const working = (list?.counts.working ?? 0) > 0 || uploading !== null;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [working, refresh]);

  async function add(incoming: File[]) {
    setProblem("");
    const ok: File[] = [];
    for (const f of incoming) {
      if (!ACCEPT.includes(f.type)) setProblem(`${f.name || "That file"} isn't a PNG, JPEG or WebP image.`);
      else if (f.size > MAX_BYTES) setProblem(`${f.name || "That image"} is over the 40 MB limit.`);
      else ok.push(f);
    }
    if (!ok.length) return;
    setUploading({ done: 0, total: ok.length, failed: [] });
    const failed: string[] = [];
    for (const [i, f] of ok.entries()) {
      try {
        await api.uploadFace(f);
      } catch (e) {
        failed.push(`${f.name}: ${errorText(e)}`);
      }
      setUploading({ done: i + 1, total: ok.length, failed: [...failed] });
      void refresh();
    }
    if (failed.length) setProblem(failed.join(" "));
    setUploading(null);
    void refresh();
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!pasted.length) return;
      e.preventDefault();
      void add(pasted);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  const shown = useMemo(
    () =>
      (list?.items ?? []).filter(
        (f) =>
          (showHidden || !f.hidden) &&
          (!starredOnly || f.starred) &&
          (!expression || f.labels?.expression === expression) &&
          (!gesture || f.labels?.gesture === gesture) &&
          (!gaze || f.labels?.gaze === gaze),
      ),
    [list, showHidden, starredOnly, expression, gesture, gaze],
  );

  const patch = (id: string, body: Parameters<typeof api.patchFace>[1]) => api.patchFace(id, body).then(refresh).catch((e) => toast(errorText(e)));
  async function remove(f: FaceView) {
    try {
      await api.deleteFace(f.id);
      setEditing(null);
      await refresh();
      toast("Deleted a photo.", { label: "Undo", run: () => api.restoreFace(f.id).then(refresh).catch((e) => toast(errorText(e))) });
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function retouchAll() {
    try {
      const r = await api.retouchFaces();
      toast(r.changed.length ? `Retouching ${r.changed.length} photo${r.changed.length === 1 ? "" : "s"}…` : "Nothing to retouch (faces switched off or not cut out yet).");
      await refresh();
    } catch (e) {
      toast(errorText(e));
    }
  }
  const setSettings = (s: Partial<FaceSettings>) => {
    if (list) setList({ ...list, settings: { ...list.settings, ...s } });
    return api.setFaceSettings(s).then(refresh).catch((err) => toast(errorText(err)));
  };
  async function reclassify(ids?: string[]) {
    try {
      const r = await api.reclassifyFaces(ids);
      if (r.skipped.length) toast(`${r.skipped.length} kept as they are (your labels, or not cut out yet).`);
      await refresh();
    } catch (e) {
      toast(errorText(e));
    }
  }

  const total = list?.counts.total ?? 0;
  const filtering = Boolean(expression || gesture || gaze || starredOnly);
  const editFace = list?.items.find((f) => f.id === editing) ?? null;

  return (
    <div className="page faces">
      <div className="lib-head">
        <h1 className="display">Faces</h1>
        {list && total > 0 && (
          <span className="muted">
            {list.counts.ready} ready{list.counts.working ? ` · ${list.counts.working} in progress` : ""}{list.counts.hidden ? ` · ${list.counts.hidden} hidden` : ""}
          </span>
        )}
      </div>
      <p className="lede">Your own face, once. Thumbnails and concept sets pick the expression and the side they need from here.</p>
      {error && <p className="banner-error" role="alert">{error}</p>}

      <div
        className={`drop faces-drop ${over ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add([...e.dataTransfer.files]);
        }}
      >
        <Icon name="upload" size={40} />
        <div>
          <strong>Drop photos of your face here, or paste them</strong>
          <span className="hint">PNG, JPEG or WebP, up to 40 MB each. Each is cut out on this computer, then Claude labels it.</span>
        </div>
        <Btn variant="primary" onClick={() => input.current?.click()}>Choose photos</Btn>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept={ACCEPT.join(",")}
          onChange={(e) => {
            void add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {uploading && (
        <div className="faces-progress" role="status">
          <Spinner label="Uploading" />
          <span>Uploading {Math.min(uploading.done + 1, uploading.total)} of {uploading.total}…</span>
          <progress max={uploading.total} value={uploading.done} />
        </div>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}

      {list && (
        <label className="faces-mirror">
          <input
            type="checkbox"
            checked={list.settings.mirrorAll}
            onChange={(e) => {
              const mirrorAll = e.target.checked;
              void setSettings({ mirrorAll });
            }}
          />
          <span>
            <strong>Mirroring: allowed for all faces unless I say otherwise.</strong>{" "}
            <span className="muted">
              {list.settings.mirrorAll ? "Designs may flip any face to look toward the text." : "Off: a face with text or a logo in the shot is never flipped. You can still allow or forbid it per face."}
            </span>
          </span>
        </label>
      )}

      {list && (
        <div className="faces-retouch">
          <label className="faces-mirror">
            <input type="checkbox" checked={list.settings.retouchAll} onChange={(e) => void setSettings({ retouchAll: e.target.checked })} />
            <span>
              <strong>Retouch faces.</strong>{" "}
              <span className="muted">
                {list.settings.retouchAll
                  ? "Designs get a balanced, brightened, lightly smoothed and sharpened version of each face (done on this computer; your photo is never changed). You can switch it off per face."
                  : "Off: designs get the plain cut-out. You can still switch it on per face."}
              </span>
            </span>
          </label>
          <div className="faces-retouch-row">
            <StrengthSlider label="Strength" value={list.settings.retouchStrength} onCommit={(v) => void setSettings({ retouchStrength: v })} />
            <Btn
              icon="refresh"
              disabled={list.counts.retouching > 0}
              onClick={() => void retouchAll()}
              title="Redo the retouch of every face at the strength shown (faces you switched off are left as they are)"
            >
              {list.counts.retouching > 0 ? `Retouching ${list.counts.retouching}…` : "Retouch all"}
            </Btn>
          </div>
        </div>
      )}

      {list && total === 0 && !uploading && (
        <section className="lib-empty faces-empty">
          <Icon name="upload" size={56} />
          <h2 className="display">No faces yet</h2>
          <p className="muted">
            Upload a varied set once: many expressions (smile, laugh, surprise, shock, thinking, sceptical, angry, a
            neutral one) and gestures (pointing both ways, hands up, a facepalm, thumbs up), looking at the camera and
            to each side. Shoot the whole head and shoulders at full camera resolution in good light; a plain background
            helps the cut-out. Fifteen to thirty photos is plenty.
          </p>
        </section>
      )}

      {total > 0 && (
        <>
          <div className="lib-filters faces-filters">
            <FilterSelect label="Expression" value={expression} onChange={setExpression} options={EXPRESSIONS} />
            <FilterSelect label="Gesture" value={gesture} onChange={setGesture} options={GESTURES} />
            <FilterSelect label="Looks" value={gaze} onChange={setGaze} options={GAZES} />
            <label className="check"><input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} /> Starred</label>
            <label className="check"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden</label>
            <span className="spacer" />
            <Btn icon="refresh" onClick={() => void reclassify()} title={`Ask ${list?.model ?? "Claude"} again for every photo you have not labelled yourself`}>
              Reclassify
            </Btn>
          </div>
          {filtering && <p className="muted small">{shown.length} of {total} shown.</p>}
          {shown.length === 0 ? (
            <p className="muted">No photo matches those filters.</p>
          ) : (
            <ul className="faces-grid">
              {shown.map((f) => (
                <FaceTile key={f.id} f={f} onOpen={() => setEditing(f.id)} onStar={() => void patch(f.id, { starred: !f.starred })} onHide={() => void patch(f.id, { hidden: !f.hidden })} onDelete={() => void remove(f)} />
              ))}
            </ul>
          )}
        </>
      )}

      {editFace && (
        <EditFace
          key={editFace.id}
          f={editFace}
          mirrorAll={list?.settings.mirrorAll ?? true}
          onClose={() => setEditing(null)}
          packRetouch={list?.settings.retouchAll ?? true}
          packStrength={list?.settings.retouchStrength ?? 0.5}
          onRetouch={(body) => patch(editFace.id, body)}
          onSave={(labels, mirrorAllowed) => patch(editFace.id, { labels, mirrorAllowed }).then(() => setEditing(null))}
          onDelete={() => void remove(editFace)}
          onReclassify={() => void reclassify([editFace.id]).then(() => setEditing(null))}
          onRecut={() => void api.recutFace(editFace.id).then(refresh).then(() => setEditing(null)).catch((e) => toast(errorText(e)))}
        />
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}: any</option>
      {options.map((o) => (
        <option key={o} value={o}>{pretty(o)}</option>
      ))}
    </select>
  );
}

function FaceTile({ f, onOpen, onStar, onHide, onDelete }: { f: FaceView; onOpen: () => void; onStar: () => void; onHide: () => void; onDelete: () => void }) {
  const busy = ["queued", "cutting", "classifying"].includes(f.stage);
  const l = f.labels;
  return (
    <li className={`face-card ${f.hidden ? "is-hidden" : ""}`}>
      <button type="button" className="face-pic" onClick={onOpen} aria-label={`Edit ${f.filename}`}>
        {f.retouch.enabled && f.retouch.thumbUrl ? (
          <img src={f.retouch.thumbUrl} alt="" loading="lazy" />
        ) : f.cutout.thumbUrl ? (
          <img src={f.cutout.thumbUrl} alt="" loading="lazy" />
        ) : (
          <img className="face-raw" src={f.original.url} alt="" loading="lazy" />
        )}
        {busy && (
          <span className="face-busy">
            <Spinner label={STAGE_TEXT[f.stage]} />
            {STAGE_TEXT[f.stage]}
          </span>
        )}
        {!busy && retouching(f) && (
          <span className="face-busy">
            <Spinner label="Retouching" />
            Retouching…
          </span>
        )}
        {f.stage === "failed" && <span className="face-busy is-bad">Cut-out failed</span>}
        {f.stage === "unclassified" && <span className="face-busy is-bad">Unclassified</span>}
        {f.quality && (
          <span className={`grade grade-${f.quality.grade}`} title={GRADE_HELP[f.quality.grade]}>
            {f.quality.grade === "4k" ? "4K" : f.quality.grade.toUpperCase()}
          </span>
        )}
      </button>
      <div className="face-meta">
        <div className="face-labels">
          {l ? (
            <>
              <strong>{pretty(l.expression)}{l.intensity > 1 ? ` ${"●".repeat(l.intensity)}` : ""}</strong>
              <span className="muted">{l.gesture !== "none" ? `${pretty(l.gesture)} · ` : ""}looks {l.gaze}</span>
            </>
          ) : (
            <span className="muted">{f.stage === "ready" ? "No labels" : f.error || STAGE_TEXT[f.stage]}</span>
          )}
        </div>
        <div className="face-actions">
          <button type="button" className={`icon-btn ${f.starred ? "is-on" : ""}`} onClick={onStar} aria-pressed={f.starred} aria-label={f.starred ? "Unstar" : "Star"} title={f.starred ? "Unstar" : "Star: Claude prefers starred faces"}>
            <Glyph name={f.starred ? "star-fill" : "star"} size={20} />
          </button>
          <button type="button" className="btn btn-ghost face-hide" onClick={onHide} aria-pressed={f.hidden} title={f.hidden ? "Show it to Claude again" : "Hide it from Claude without deleting"}>
            {f.hidden ? "Show" : "Hide"}
          </button>
          <button type="button" className="icon-btn" onClick={onDelete} aria-label="Delete" title="Delete (you can undo)">
            <Glyph name="trash" size={20} />
          </button>
        </div>
      </div>
    </li>
  );
}

function EditFace({ f, mirrorAll, packRetouch, packStrength, onRetouch, onClose, onSave, onDelete, onReclassify, onRecut }: {
  f: FaceView;
  mirrorAll: boolean;
  packRetouch: boolean;
  packStrength: number;
  onRetouch: (body: { retouch?: boolean | null; retouchStrength?: number | null }) => Promise<unknown>;
  onClose: () => void;
  onSave: (labels: NonNullable<FaceView["labels"]>, mirror: boolean | null) => Promise<void>;
  onDelete: () => void;
  onReclassify: () => void;
  onRecut: () => void;
}) {
  const start = f.labels ?? { expression: "neutral", intensity: 1, gesture: "none", gaze: "camera", headTurn: "frontal", eyesOpen: true, textOrLogoInShot: false, description: "" };
  const [labels, setLabels] = useState({ ...start });
  const [mirror, setMirror] = useState<"" | "yes" | "no">(f.mirrorAllowed === null ? "" : f.mirrorAllowed ? "yes" : "no");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof labels>(k: K, v: (typeof labels)[K]) => setLabels((x) => ({ ...x, [k]: v }));
  const effective = mirror === "yes" ? true : mirror === "no" ? false : mirrorAll ? true : !labels.textOrLogoInShot;
  const { faceBox: _box, ...editable } = labels as typeof labels & { faceBox?: unknown };
  return (
    <Dialog title="This photo" onClose={onClose}>
      <div className="face-edit">
        <div className="face-edit-pic">
          <Compare before={f.cutout.url ?? f.original.url} after={f.retouch.url} busy={retouching(f)} />
          <p className="muted small mono">
            {f.original.width} × {f.original.height}
            {f.quality ? ` · face ${f.quality.faceHeightPx} px · ${f.quality.grade.toUpperCase()}${f.quality.sharpness !== null ? ` · sharpness ${f.quality.sharpness}` : ""}` : ""}
          </p>
          {f.quality && <p className="muted small">{GRADE_HELP[f.quality.grade]}</p>}
        </div>
        <div className="face-edit-form">
          {f.stage === "failed" && (
            <p className="field-error">The cut-out failed: {f.error} <Btn onClick={onRecut}>Retry cut-out</Btn></p>
          )}
          {f.stage === "unclassified" && (
            <p className="field-error">{f.error || "Not classified yet."} <Btn onClick={onReclassify}>Retry</Btn></p>
          )}
          <Sel label="Expression" value={labels.expression} options={EXPRESSIONS} onChange={(v) => set("expression", v)} />
          <label className="field">
            <span>Intensity</span>
            <select value={labels.intensity} onChange={(e) => set("intensity", Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>1 slight</option>
              <option value={2}>2 clear</option>
              <option value={3}>3 extreme</option>
            </select>
          </label>
          <Sel label="Gesture" value={labels.gesture} options={GESTURES} onChange={(v) => set("gesture", v)} />
          <Sel label="Looks (in the picture)" value={labels.gaze} options={GAZES} onChange={(v) => set("gaze", v)} />
          <Sel label="Head turn" value={labels.headTurn} options={HEAD_TURNS} onChange={(v) => set("headTurn", v)} />
          <label className="check"><input type="checkbox" checked={labels.eyesOpen} onChange={(e) => set("eyesOpen", e.target.checked)} /> Eyes open</label>
          <label className="check"><input type="checkbox" checked={labels.textOrLogoInShot} onChange={(e) => set("textOrLogoInShot", e.target.checked)} /> Text or a logo in the shot</label>
          <fieldset className="face-retouch-edit">
            <legend>Retouch</legend>
            <label className="field">
              <span>This face</span>
              <select
                value={f.retouch.override === null ? "" : f.retouch.override ? "yes" : "no"}
                onChange={(e) => void onRetouch({ retouch: e.target.value === "" ? null : e.target.value === "yes" })}
              >
                <option value="">Follow the pack setting ({packRetouch ? "on" : "off"})</option>
                <option value="yes">Retouched</option>
                <option value="no">Plain cut-out</option>
              </select>
            </label>
            <StrengthSlider
              label="Strength"
              value={f.retouch.strength}
              onCommit={(v) => void onRetouch({ retouchStrength: v })}
              disabled={f.retouch.override === false || (f.retouch.override === null && !packRetouch)}
            />
            {f.retouch.ownStrength !== null && (
              <button type="button" className="btn btn-ghost face-retouch-reset" onClick={() => void onRetouch({ retouchStrength: null })}>
                Use the pack strength ({percent(packStrength)})
              </button>
            )}
            {f.retouch.state === "failed" && <p className="field-error">{f.retouch.error}</p>}
            <p className="muted small">
              Tone and texture only: colour balance, exposure, a little warmth, softer skin, less redness and a light sharpen. Shape and likeness are never changed.
              {f.retouch.state === "done" && f.retouch.appliedStrength !== null && f.retouch.appliedStrength !== f.retouch.strength ? " The picture is being redone at this strength." : ""}
            </p>
          </fieldset>
          <label className="field">
            <span>Mirroring</span>
            <select value={mirror} onChange={(e) => setMirror(e.target.value as "" | "yes" | "no")}>
              <option value="">Follow the pack setting ({mirrorAll ? "allowed" : "by the label"})</option>
              <option value="yes">Allowed for this face</option>
              <option value="no">Never mirror this face</option>
            </select>
            <span className="muted small">Effective: {effective ? "may be mirrored" : "never mirrored"}.</span>
          </label>
          <label className="field">
            <span>Description</span>
            <input type="text" maxLength={140} value={labels.description} onChange={(e) => set("description", e.target.value)} />
          </label>
          <FaceUsagePanel faceId={f.id} />
          {f.labelsEditedByOwner && <p className="muted small">You edited these labels, so Reclassify leaves them alone.</p>}
        </div>
      </div>
      <div className="dialog-actions">
        <Btn variant="danger" onClick={onDelete}>Delete</Btn>
        <span className="spacer" />
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={saving || !labels.description.trim()}
          onClick={() => {
            setSaving(true);
            void onSave(editable as NonNullable<FaceView["labels"]>, mirror === "" ? null : mirror === "yes").finally(() => setSaving(false));
          }}
        >
          Save
        </Btn>
      </div>
    </Dialog>
  );
}

/** A range that reports its value once it is released, so dragging does not queue a retouch per step. */
function StrengthSlider({ label, value, onCommit, disabled }: { label: string; value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && Math.abs(draft - value) > 0.001) onCommit(draft);
    setDraft(null);
  };
  return (
    <label className="field strength">
      <span>
        {label}: <strong>{percent(shown)}</strong>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(shown * 100)}
        disabled={disabled}
        aria-valuetext={percent(shown)}
        onChange={(e) => setDraft(Number(e.target.value) / 100)}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

/** Before and after in one frame: drag the handle to reveal the retouched face over the plain cut-out. */
function Compare({ before, after, busy }: { before: string; after: string | null; busy: boolean }) {
  const [at, setAt] = useState(50);
  if (!after) {
    return (
      <div className="ba-compare">
        <img src={before} alt="" />
        {busy && <span className="face-busy"><Spinner label="Retouching" />Retouching…</span>}
      </div>
    );
  }
  return (
    <div className="ba-compare">
      <img src={before} alt="Before: the plain cut-out" />
      <img className="compare-after" src={after} alt="After: retouched" style={{ clipPath: `inset(0 0 0 ${at}%)` }} />
      <span className="compare-tag is-before">Before</span>
      <span className="compare-tag is-after">After</span>
      <span className="compare-line" style={{ left: `${at}%` }} aria-hidden="true" />
      <input type="range" min={0} max={100} value={at} aria-label="Compare before and after" onChange={(e) => setAt(Number(e.target.value))} />
      {busy && <span className="face-busy"><Spinner label="Retouching" />Redoing…</span>}
    </div>
  );
}

function Sel<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>{pretty(o)}</option>
        ))}
      </select>
    </label>
  );
}
