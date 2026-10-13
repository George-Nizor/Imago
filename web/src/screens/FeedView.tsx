import { useEffect, useState } from "react";
import { api } from "../api/index.js";
import type { Check, Project } from "../api/types.js";
import { Icon } from "../brand/Icon.js";
import { FeedPreview } from "../feed/FeedPreview.js";
import { formatOfSize, surfacesFor, type FeedNeighbour } from "../feed/feed-lib.js";

/** The checks of a version, worst first as the server lists them: a plain list, never a score. */
export function ChecksList({ checks }: { checks: Check[] | undefined }) {
  if (!checks?.length) return <p className="muted small">No measurements for this version.</p>;
  return (
    <ul className="checks" aria-label="Checks">
      {checks.map((c) => (
        <li key={c.id} className={`check ${c.level}`}>
          <Icon name={c.level === "warn" ? "alert" : "done"} size={16} />
          <span className="mono check-id">{c.id}</span>
          <span className="check-msg">{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Thumbnails of the owner's other designs of the same shape, newest first; empty means stand-ins. */
function useNeighbours(project: Project): FeedNeighbour[] {
  const [items, setItems] = useState<FeedNeighbour[]>([]);
  const format = formatOfSize(project.size);
  useEffect(() => {
    let live = true;
    api
      .listProjects({ preset: "thumbnail", sort: "edited", limit: 24 })
      .then((list) => {
        if (!live) return;
        setItems(
          list.items
            .filter((p) => p.id !== project.id && p.thumbnail && formatOfSize(p.size) === format)
            .slice(0, 8)
            .map((p) => ({ src: p.thumbnail!, title: p.title })),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [project.id, format]);
  return items;
}

export function FeedView({ project }: { project: Project }) {
  const format = formatOfSize(project.size);
  const surfaces = surfacesFor(format);
  const [surface, setSurface] = useState(surfaces[0]!.id);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const neighbours = useNeighbours(project);
  const current = project.versions.find((v) => v.n === project.current);
  const active = surfaces.some((s) => s.id === surface) ? surface : surfaces[0]!.id;
  const title = String(project.brief.title ?? project.title);
  const src = project.current ? api.renderUrl(project.id, project.current) : "";
  // Full-screen players are dark apps whatever the page theme is.
  const fixedDark = ["shorts", "reels", "tiktok"].includes(active);

  if (!project.current) return <div className="feed"><p className="muted">Nothing to show yet. Once there is a render, it appears here among other thumbnails.</p></div>;
  return (
    <div className="feed">
      <div className="feed-controls">
        <div className="seg wrap" role="radiogroup" aria-label="Where to show it">
          {surfaces.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={active === s.id} className={active === s.id ? "on" : ""} onClick={() => setSurface(s.id)}>{s.label}</button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(["dark", "light"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} disabled={fixedDark} onClick={() => setTheme(t)}>{t === "dark" ? "Dark" : "Light"}</button>
          ))}
        </div>
      </div>
      <div className="feed-stage">
        <FeedPreview src={src} format={format} title={title} neighbours={neighbours} theme={fixedDark ? "dark" : theme} surface={active} />
      </div>
      <p className="muted small">
        {neighbours.length ? "Neighbours are your other designs of this shape." : "No other designs of this shape yet, so the neighbours are stand-ins."} The outlined one is this design.
      </p>
      <h2 className="label">Checks <span className="mono muted small">v{project.current}</span></h2>
      <ChecksList checks={current?.checks} />
    </div>
  );
}
