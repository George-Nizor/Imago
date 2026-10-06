import { useEffect, useRef, useState } from "react";
import { api } from "../api/index.js";
import type { CreateBody, PresetId, PresetInfo, Project, Size } from "../api/types.js";
import { canCreate, useCaps } from "../caps.js";
import { Icon } from "../brand/Icon.js";
import { Btn, CapabilityPanel, Dropzone, Spinner } from "../components.js";
import { useSeries } from "../library/hooks.js";
import { SeriesField } from "../library/ui.js";
import { errorText, fmtSize, navigate } from "../lib.js";
import { THUMBNAIL_FORMATS, graphicSizes, photoAspects, presetUi } from "../presets.js";

type Stage = { label: string; state: "todo" | "doing" | "done" };

export function NewProject({ preset, style }: { preset: PresetId; style?: string }) {
  const ui = presetUi(preset);
  const { caps, checking, recheck } = useCaps();
  const ok = canCreate(caps);
  const [info, setInfo] = useState<PresetInfo | undefined>();
  useEffect(() => {
    api.presets().then((all) => setInfo(all.find((p) => p.id === preset))).catch(() => {});
  }, [preset]);
  // "New in this style": the canvas, format and series come from an earlier design.
  const [source, setSource] = useState<Project | null>(null);
  const [sourceError, setSourceError] = useState("");
  useEffect(() => {
    if (!style) return;
    api.getProject(style).then((p) => (p.preset === preset ? setSource(p) : setSourceError("That design is a different kind of project."))).catch((e) => setSourceError(errorText(e)));
  }, [style, preset]);
  const styled = Boolean(style);
  const { series: allSeries } = useSeries();
  const [seriesChoice, setSeriesChoice] = useState(""); // "" none, an id, or "__new"
  const [seriesName, setSeriesName] = useState("");
  const createdSeries = useRef<string | null>(null);
  const sizes = graphicSizes(info);
  const aspects = photoAspects(info);

  const [title, setTitle] = useState("");
  const [colours, setColours] = useState("");
  const [notes, setNotes] = useState("");
  const [instruction, setInstruction] = useState("");
  const [aspect, setAspect] = useState("original");
  const [description, setDescription] = useState("");
  const [sizeId, setSizeId] = useState("ig-square"); // a graphic size id, or "custom"
  const [format, setFormat] = useState("video");
  const [custom, setCustom] = useState({ width: "1080", height: "1080" });
  const [files, setFiles] = useState<File[]>([]);

  const [stages, setStages] = useState<Stage[] | null>(null);
  const [fileNote, setFileNote] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  // What a failed attempt already did, so "Design it" again carries on instead of starting a second project.
  const createdId = useRef<string | null>(null);
  const uploads = useRef(new Map<File, { name: string; cut: boolean }>());
  const busy = stages !== null && !error;

  const picked = sizeId === "custom" ? undefined : sizes.find((s) => s.id === sizeId) ?? sizes[0];
  const groups = [...new Set(sizes.map((s) => s.group))];
  const customOk = [custom.width, custom.height].every((v) => Number(v) >= 64 && Number(v) <= 4096);
  const ready =
    ok &&
    (preset === "thumbnail" ? title.trim().length > 0 : preset === "photo" ? files.length > 0 && instruction.trim().length > 0 : description.trim().length > 0) &&
    (preset !== "graphic" || styled || picked !== undefined || customOk) &&
    (!styled || source !== null) &&
    (seriesChoice !== "__new" || seriesName.trim().length > 0);

  async function submit() {
    setError("");
    const uploadsFirst = files.length > 0;
    const plan: Stage[] = [
      { label: "Creating the project", state: "doing" },
      ...(uploadsFirst ? [{ label: files.length > 1 ? `Uploading ${files.length} images` : "Uploading your image", state: "todo" as const }] : []),
      ...(preset === "thumbnail" && uploadsFirst ? [{ label: "Cutting out the background", state: "todo" as const }] : []),
      { label: "Briefing Claude", state: "todo" },
    ];
    setStages(plan);
    const mark = (i: number, state: Stage["state"]) => setStages((s) => s && s.map((x, j) => (j === i ? { ...x, state } : x)));
    let at = 0;
    const next = () => {
      mark(at, "done");
      at += 1;
      mark(at, "doing");
    };

    try {
      let size: Size | undefined;
      let brief: Record<string, string> = {};
      let projectTitle = "";
      if (preset === "thumbnail") {
        brief = { format, title: title.trim(), ...(colours.trim() && { channelColours: colours.trim() }), ...(notes.trim() && { notes: notes.trim() }) };
        projectTitle = title.trim();
      } else if (preset === "photo") {
        brief = { instruction: instruction.trim(), aspect };
        projectTitle = shortTitle(instruction);
        // No size: the server sets the canvas from the first upload and brief.aspect.
      } else {
        brief = { description: description.trim() };
        projectTitle = shortTitle(description);
        size = picked ? picked.size : { width: Number(custom.width), height: Number(custom.height) };
      }
      if (!createdId.current) {
        if (styled) {
          // The server keeps the source's canvas and format, joins its series and copies its look.
          createdId.current = (await api.newInStyle(style!, { title: projectTitle, brief })).id;
        } else {
          let series: string | undefined = seriesChoice && seriesChoice !== "__new" ? seriesChoice : undefined;
          if (seriesChoice === "__new") series = createdSeries.current ??= (await api.createSeries(seriesName.trim())).id;
          const body: CreateBody = { preset, title: projectTitle, brief, ...(size && { size }), ...(series && { series }) };
          createdId.current = (await api.createProject(body)).id;
        }
      }
      const projectId = createdId.current;

      if (uploadsFirst) {
        next();
        for (const f of files) {
          if (uploads.current.has(f)) {
            setFileNote((n) => ({ ...n, [f.name]: "Uploaded" }));
            continue;
          }
          setFileNote((n) => ({ ...n, [f.name]: "Uploading…" }));
          const up = await api.uploadAsset(projectId, f);
          uploads.current.set(f, { name: up.name, cut: false });
          setFileNote((n) => ({ ...n, [f.name]: "Uploaded" }));
        }
      }
      if (preset === "thumbnail" && uploadsFirst) {
        next();
        for (const f of files) {
          const entry = uploads.current.get(f)!;
          if (entry.cut) continue;
          setFileNote((n) => ({ ...n, [f.name]: "Cutting out…" }));
          try {
            uploads.current.set(f, { name: (await api.cutout(projectId, entry.name)).name, cut: true });
            setFileNote((n) => ({ ...n, [f.name]: "Cut out" }));
          } catch {
            // The photo still works as it is; Claude can run the cut-out itself.
            uploads.current.set(f, { name: entry.name, cut: true });
            setFileNote((n) => ({ ...n, [f.name]: "Kept as is" }));
          }
        }
      }
      next();
      const uploaded = files.map((f) => uploads.current.get(f)!.name);
      try {
        await api.sendMessage(projectId, firstMessage(preset, { title, colours, notes, instruction, description, size }, uploaded, styled || (preset === "thumbnail" && Boolean(seriesChoice) && seriesChoice !== "__new" && Boolean(allSeries.find((s) => s.id === seriesChoice)?.styleProjectId))));
      } catch {
        // The project and its images exist; the workspace is where the user can send the brief again.
      }
      mark(at, "done");
      navigate(`/p/${projectId}`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="page form-page">
      <a className="back" href={styled ? "/library" : "/"} onClick={(e) => { e.preventDefault(); navigate(styled ? "/library" : "/"); }}>{styled ? "← Library" : "← All presets"}</a>
      <div className="form-head">
        <Icon name={ui.icon} size={56} />
        <h1 className="display">{ui.label}</h1>
      </div>

      {caps && !ok && <CapabilityPanel caps={caps} checking={checking} onRecheck={recheck} />}
      {styled && (
        <section className="style-note" aria-label="Series style">
          {source?.current ? <img src={api.renderUrl(source.id, source.current)} alt="" width={160} /> : null}
          <div>
            <strong>New in the style of “{source?.title ?? "…"}”</strong>
            <p className="muted small">
              The same {fmtSize(source?.size ?? { width: 0, height: 0 })} canvas, and Claude will match its layout, type and colours. Only the content changes.
              {source ? (source.series ? " It joins the same series." : " A series named after it is created.") : ""}
            </p>
            {sourceError && <p className="field-error" role="alert">{sourceError}</p>}
          </div>
        </section>
      )}

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void submit();
        }}
      >
        <fieldset disabled={busy} className="fields">
          {preset === "thumbnail" && (
            <>
              {!styled && <div className="field">
                <span className="label">Format</span>
                <div className="seg" role="radiogroup" aria-label="Thumbnail format">
                  {THUMBNAIL_FORMATS.map((f) => (
                    <button key={f.id} type="button" role="radio" aria-checked={format === f.id} className={format === f.id ? "on" : ""} onClick={() => setFormat(f.id)}>
                      {f.label}
                      <span className="mono muted">{f.size.width}×{f.size.height} → {f.hint}</span>
                    </button>
                  ))}
                </div>
              </div>}
              <label className="field">
                <span className="label">Title or topic</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="I built a rocket in my garage" autoFocus />
              </label>
              <div className="field">
                <span className="label">Your face <em>optional, the background is removed for you</em></span>
                <Dropzone files={files} onChange={setFiles} multiple busy={busy} status={fileNote} title="Drop face photos here" hint="or paste from the clipboard (PNG, JPEG, WebP)" />
              </div>
              <label className="field">
                <span className="label">Channel colours <em>optional</em></span>
                <input value={colours} onChange={(e) => setColours(e.target.value)} placeholder="Teal and white, or #00BCAB" />
              </label>
              <label className="field">
                <span className="label">Notes <em>optional</em></span>
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Keep it clean. A rocket in the background would be great." />
              </label>
              {!styled && <SeriesField series={allSeries} choice={seriesChoice} name={seriesName} onChoice={setSeriesChoice} onName={setSeriesName} />}
            </>
          )}

          {preset === "photo" && (
            <>
              <div className="field">
                <span className="label">Your photo</span>
                <Dropzone files={files} onChange={setFiles} busy={busy} status={fileNote} title="Drop a photo here" hint="or paste from the clipboard (PNG, JPEG, WebP)" />
              </div>
              <label className="field">
                <span className="label">What should happen to it?</span>
                <textarea rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Warm up the colours and crop it tighter around the dog." />
              </label>
              {!styled && <div className="field">
                <span className="label">Shape</span>
                <div className="seg" role="radiogroup" aria-label="Aspect ratio">
                  {aspects.map((a) => (
                    <button key={a.id} type="button" role="radio" aria-checked={aspect === a.id} className={aspect === a.id ? "on" : ""} onClick={() => setAspect(a.id)}>
                      <span className={a.id === "original" ? "" : "mono"}>{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>}
            </>
          )}

          {preset === "graphic" && (
            <>
              <label className="field">
                <span className="label">What do you need?</span>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A poster for our spring plant sale: friendly, lots of green, date and place at the bottom." autoFocus />
              </label>
              {!styled && <div className="field">
                <span className="label">Size</span>
                <select aria-label="Size" className="size-select" value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
                  {groups.map((g) => (
                    <optgroup key={g} label={g}>
                      {sizes.filter((x) => x.group === g).map((x) => (
                        <option key={x.id} value={x.id}>{x.label} · {x.size.width}×{x.size.height}</option>
                      ))}
                    </optgroup>
                  ))}
                  <option value="custom">Custom size…</option>
                </select>
                {sizeId === "custom" && (
                  <div className="custom-size">
                    <input aria-label="Width in pixels" className="mono" inputMode="numeric" value={custom.width} onChange={(e) => setCustom({ ...custom, width: e.target.value.replace(/\D/g, "") })} />
                    <span aria-hidden="true">×</span>
                    <input aria-label="Height in pixels" className="mono" inputMode="numeric" value={custom.height} onChange={(e) => setCustom({ ...custom, height: e.target.value.replace(/\D/g, "") })} />
                    <span className={customOk ? "muted small" : "field-error"}>64 to 4096 pixels each side</span>
                  </div>
                )}
              </div>}
              <div className="field">
                <span className="label">Reference images <em>optional</em></span>
                <Dropzone files={files} onChange={setFiles} multiple busy={busy} status={fileNote} title="Drop references here" hint="a logo, a mood, a layout you like" />
              </div>
            </>
          )}
        </fieldset>

        {stages && (
          <ol className="stages" aria-live="polite">
            {stages.map((s) => (
              <li key={s.label} className={`stage-${s.state}`}>
                {s.state === "doing" && !error ? <Spinner /> : <Icon name={s.state === "done" ? "done" : "sparkle"} size={20} className={s.state === "todo" ? "dim" : ""} />}
                {s.label}
              </li>
            ))}
          </ol>
        )}
        {error && <p className="banner-error" role="alert">{error}</p>}

        <div className="form-actions">
          <Btn type="submit" variant="primary" icon="sparkle" size={22} disabled={!ready || busy}>
            {busy ? "Working…" : "Design it"}
          </Btn>
          {preset === "graphic" && picked && <span className="mono muted">{picked.group}: {picked.label}, {fmtSize(picked.size)}</span>}
        </div>
      </form>
    </div>
  );
}

/** The short text that starts the first turn; the server adds the full brief around it. */
function firstMessage(
  preset: PresetId,
  f: { title: string; colours: string; notes: string; instruction: string; description: string; size: Size | undefined },
  assets: string[],
  inSeries = false,
): string {
  const list = assets.map((a) => `assets/${a}`).join(", ");
  const series = inSeries ? " This is a new episode in a series: read the series style reference and match it exactly; change only the title and the imagery." : "";
  if (preset === "thumbnail") {
    return [
      `Make a YouTube thumbnail for: ${sentence(f.title)}`,
      assets.length ? `My face photos are ${list}; use them.` : "",
      f.colours.trim() ? `Channel colours: ${sentence(f.colours)}` : "",
      f.notes.trim(),
      series.trim(),
    ].filter(Boolean).join(" ");
  }
  if (preset === "photo") return `Edit my photo (${list}): ${f.instruction.trim()}${series}`;
  return [f.description.trim(), assets.length ? `Reference images: ${list}.` : "", series.trim()].filter(Boolean).join(" ");
}

/** A project name from free text: its first clause, cut at a word boundary rather than mid-word. */
function shortTitle(text: string, max = 40): string {
  const clause = text.trim().split(/[.!?\n:;]/)[0]!.trim();
  if (clause.length <= max) return clause;
  const cut = clause.slice(0, max + 1).replace(/\s+\S*$/, "");
  return `${cut || clause.slice(0, max)}…`;
}

/** Ends text with a full stop unless it already ends a sentence ("explode?" stays as it is). */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}
