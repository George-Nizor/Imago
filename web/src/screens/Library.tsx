import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/index.js";
import type { LibrarySort, PresetId, ProjectSummary } from "../api/types.js";
import { Icon } from "../brand/Icon.js";
import { Btn } from "../components.js";
import { downloadZip, useDeleteWithUndo, useSeries, useToast } from "../library/hooks.js";
import { Glyph, MenuButton, SeriesDialog, type MenuItem } from "../library/ui.js";
import { errorText, fmtSize, navigate, shortAgo } from "../lib.js";
import { PRESET_UI, presetUi } from "../presets.js";

const PAGE = 40;
const SORTS: { id: LibrarySort; label: string }[] = [
  { id: "edited", label: "Recently edited" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "title", label: "Title A–Z" },
];

export function Library() {
  const toast = useToast();
  const { series, refresh: refreshSeries } = useSeries();
  const deleteWithUndo = useDeleteWithUndo();

  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [preset, setPreset] = useState<PresetId | "">("");
  const [seriesId, setSeriesId] = useState(""); // "" = all, "none" = outside any series
  const [starred, setStarred] = useState(false);
  const [sort, setSort] = useState<LibrarySort>("edited");

  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);

  const filters = useMemo(
    () => ({ query, ...(preset && { preset }), ...(seriesId && { series: seriesId }), ...(starred && { starred: true }), sort }),
    [query, preset, seriesId, starred, sort],
  );
  const filtered = Boolean(query || preset || seriesId || starred);

  useEffect(() => {
    const t = setTimeout(() => setQuery(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);

  /** Loads the first page again, or as many as are showing, so an edit keeps its place. */
  const load = useCallback(
    async (keep = 0) => {
      const mine = ++request.current;
      try {
        const page = await api.listProjects({ ...filters, offset: 0, limit: Math.max(PAGE, keep) });
        if (mine !== request.current) return;
        setItems(page.items);
        setTotal(page.total);
        setError("");
      } catch (e) {
        if (mine === request.current) {
          setItems((x) => x ?? []);
          setError(errorText(e));
        }
      }
    },
    [filters],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function more() {
    if (!items || loadingMore) return;
    const mine = request.current;
    setLoadingMore(true);
    try {
      const page = await api.listProjects({ ...filters, offset: items.length, limit: PAGE });
      if (mine !== request.current) return;
      setItems((cur) => {
        const seen = new Set((cur ?? []).map((p) => p.id));
        return [...(cur ?? []), ...page.items.filter((p) => !seen.has(p.id))];
      });
      setTotal(page.total);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const seriesName = useMemo(() => new Map(series.map((s) => [s.id, s.name])), [series]);
  const shown = useMemo(() => items ?? [], [items]);
  // Whatever has gone from the list (deleted, filtered out) is no longer selected.
  const chosen = useMemo(() => shown.filter((p) => picked.has(p.id)), [shown, picked]);
  const selecting = selectMode || chosen.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && chosen.length && !document.querySelector('[role="dialog"], [role="menu"]')) setPicked(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chosen.length]);

  function toggle(id: string, shift: boolean) {
    // Read the anchor now: the updater below runs later, after the anchor has moved on.
    const from = anchor.current ? shown.findIndex((p) => p.id === anchor.current) : -1;
    const to = shown.findIndex((p) => p.id === id);
    setPicked((cur) => {
      const next = new Set(cur);
      if (shift && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        const on = !cur.has(id);
        for (const p of shown.slice(a, b + 1)) {
          if (on) next.add(p.id);
          else next.delete(p.id);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }

  const patchLocal = (id: string, patch: Partial<ProjectSummary>) => setItems((cur) => cur && cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  async function star(p: ProjectSummary) {
    patchLocal(p.id, { starred: !p.starred });
    try {
      await api.patchProject(p.id, { starred: !p.starred });
      if (starred && p.starred) void load(items?.length);
    } catch (e) {
      patchLocal(p.id, { starred: p.starred });
      toast(errorText(e));
    }
  }
  async function rename(p: ProjectSummary, title: string | null) {
    setRenaming(null);
    const next = title?.trim();
    if (!next || next === p.title) return;
    patchLocal(p.id, { title: next });
    try {
      await api.patchProject(p.id, { title: next });
    } catch (e) {
      patchLocal(p.id, { title: p.title });
      toast(errorText(e));
    }
  }
  async function duplicate(p: ProjectSummary) {
    try {
      const copy = await api.duplicateProject(p.id);
      await load(items?.length);
      toast(`Made "${copy.title}".`, { label: "Open", run: () => navigate(`/p/${copy.id}`) });
    } catch (e) {
      toast(errorText(e));
    }
  }
  const remove = (ids: string[], label?: string) =>
    deleteWithUndo(ids, () => {
      void load(items?.length);
      void refreshSeries();
    }, label).catch((e) => toast(errorText(e)));

  async function moveTo(ids: string[], to: string | null) {
    await api.bulk("series", ids, to);
    await Promise.all([load(items?.length), refreshSeries()]);
  }

  function menuFor(p: ProjectSummary): MenuItem[] {
    return [
      { label: "Open", onSelect: () => navigate(`/p/${p.id}`) },
      { label: "Rename", onSelect: () => setRenaming(p.id) },
      { label: p.starred ? "Remove star" : "Star", onSelect: () => void star(p) },
      { label: "Duplicate", onSelect: () => void duplicate(p) },
      { label: "New in this style", disabled: !p.current, onSelect: () => navigate(`/new/${p.preset}?style=${encodeURIComponent(p.id)}`) },
      { label: "Move to series…", onSelect: () => setMoving([p.id]) },
      { label: "Delete", danger: true, divider: true, onSelect: () => void remove([p.id], p.title) },
    ];
  }

  const ids = chosen.map((p) => p.id);
  const allShown = shown.length > 0 && chosen.length === shown.length;
  const allStarred = chosen.length > 0 && chosen.every((p) => p.starred);
  const exportable = chosen.filter((p) => p.current).map((p) => p.id);

  async function bulkStar() {
    try {
      await api.bulk(allStarred ? "unstar" : "star", ids);
      await load(items?.length);
    } catch (e) {
      toast(errorText(e));
    }
  }

  function clearFilters() {
    setTyped("");
    setQuery("");
    setPreset("");
    setSeriesId("");
    setStarred(false);
  }

  return (
    <div className={`page library ${chosen.length ? "has-bar" : ""}`}>
      <a className="back" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>← Start</a>
      <div className="lib-head">
        <h1 className="display">Library</h1>
        <span className="muted mono small" aria-live="polite">{items ? `${total} ${total === 1 ? "design" : "designs"}${filtered ? " match" : ""}` : ""}</span>
      </div>

      <div className="lib-filters" role="search">
        <label className="lib-search">
          <span className="sr-only">Search by title or brief</span>
          <Glyph name="search" size={18} />
          <input type="search" placeholder="Search titles and briefs" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
        <select aria-label="Preset" value={preset} onChange={(e) => setPreset(e.target.value as PresetId | "")}>
          <option value="">All presets</option>
          {PRESET_UI.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select aria-label="Series" value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
          <option value="">All series</option>
          <option value="none">No series</option>
          {series.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.count ?? 0})</option>)}
        </select>
        <button type="button" className={`chip filter-chip ${starred ? "on" : ""}`} aria-pressed={starred} onClick={() => setStarred(!starred)}>
          <Glyph name={starred ? "star-fill" : "star"} size={16} /> Starred
        </button>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button
          type="button"
          className={`chip filter-chip ${selectMode ? "on" : ""}`}
          aria-pressed={selectMode}
          onClick={() => {
            setSelectMode(!selectMode);
            if (selectMode) setPicked(new Set());
          }}
        >
          <Glyph name="check" size={16} /> Select
        </button>
      </div>

      {error && <p className="banner-error" role="alert">{error}</p>}

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 && !error ? (
        filtered ? (
          <div className="lib-empty">
            <h2 className="display">Nothing matches</h2>
            <p className="muted">No design fits those filters. Try fewer words, or start again.</p>
            <Btn onClick={clearFilters}>Clear filters</Btn>
          </div>
        ) : (
          <div className="lib-empty">
            <Icon name="sparkle" size={48} />
            <h2 className="display">No designs yet</h2>
            <p className="muted">Everything you make with Imago will be kept here.</p>
            <Btn variant="primary" onClick={() => navigate("/")}>Make something</Btn>
          </div>
        )
      ) : (
        <>
          {selecting && (
            <label className="lib-selectall">
              <input
                type="checkbox"
                checked={allShown}
                ref={(el) => {
                  if (el) el.indeterminate = !allShown && chosen.length > 0;
                }}
                onChange={() => setPicked(allShown ? new Set() : new Set(shown.map((p) => p.id)))}
              />
              Select all {shown.length} shown
              {total > shown.length && <span className="muted small"> (load more to include the other {total - shown.length})</span>}
            </label>
          )}
          <ul className="lib-grid">
            {shown.map((p) => (
              <LibCard
                key={p.id}
                p={p}
                seriesName={p.series ? seriesName.get(p.series) ?? "Series" : null}
                selected={picked.has(p.id)}
                selecting={selecting}
                renaming={renaming === p.id}
                menu={menuFor(p)}
                onToggle={(shift) => toggle(p.id, shift)}
                onStar={() => void star(p)}
                onRename={(title) => void rename(p, title)}
                onSeries={() => setSeriesId(p.series ?? "")}
              />
            ))}
          </ul>
          {shown.length < total && (
            <div className="lib-more">
              <Btn onClick={() => void more()} disabled={loadingMore}>{loadingMore ? "Loading…" : `Load more (${total - shown.length} left)`}</Btn>
            </div>
          )}
        </>
      )}

      {chosen.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Actions for the selected designs">
          <span className="bulk-count mono">{chosen.length} selected</span>
          <Btn onClick={() => void bulkStar()}>{allStarred ? "Remove star" : "Star"}</Btn>
          <Btn onClick={() => setMoving(ids)}>Move to series</Btn>
          <Btn disabled={!exportable.length} title={exportable.length ? "Download each current render as a zip" : "None of them has a render yet"} onClick={() => downloadZip(exportable)}>Export</Btn>
          <Btn variant="danger" onClick={() => void remove(ids, ids.length === 1 ? shown.find((p) => p.id === ids[0])?.title : undefined).then(() => setPicked(new Set()))}>Delete</Btn>
          <Btn onClick={() => { setPicked(new Set()); setSelectMode(false); }}>Clear</Btn>
        </div>
      )}

      {moving && (
        <SeriesDialog
          count={moving.length}
          current={moving.length === 1 ? shown.find((p) => p.id === moving[0])?.series : null}
          series={series}
          onPick={(to) => moveTo(moving, to)}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

function LibCard({
  p,
  seriesName,
  selected,
  selecting,
  renaming,
  menu,
  onToggle,
  onStar,
  onRename,
  onSeries,
}: {
  p: ProjectSummary;
  seriesName: string | null;
  selected: boolean;
  selecting: boolean;
  renaming: boolean;
  menu: MenuItem[];
  onToggle: (shift: boolean) => void;
  onStar: () => void;
  onRename: (title: string | null) => void;
  onSeries: () => void;
}) {
  const ui = presetUi(p.preset);

  return (
    <li className={`lib-card ${selected ? "is-selected" : ""} ${selecting ? "is-selecting" : ""}`}>
      <a
        className="lib-link"
        href={`/p/${p.id}`}
        aria-label={`Open ${p.title}`}
        onClick={(e) => {
          e.preventDefault();
          if (selecting || e.shiftKey || e.ctrlKey || e.metaKey) onToggle(e.shiftKey);
          else navigate(`/p/${p.id}`);
        }}
      >
        <span className="lib-thumb">
          {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" decoding="async" /> : <Icon name={ui.icon} size={44} className="dim" />}
        </span>
      </a>
      <label className="lib-check" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${p.title}`}
          onChange={() => {}}
          onClick={(e) => onToggle(e.shiftKey)}
        />
        <span className="lib-check-box" aria-hidden="true"><Glyph name="check" size={16} /></span>
      </label>
      <div className="lib-tools">
        <button type="button" className={`icon-btn star-btn ${p.starred ? "on" : ""}`} aria-pressed={p.starred} aria-label={p.starred ? `Remove star from ${p.title}` : `Star ${p.title}`} onClick={onStar}>
          <Glyph name={p.starred ? "star-fill" : "star"} size={20} />
        </button>
        <MenuButton label={`Actions for ${p.title}`} items={menu} />
      </div>
      <div className="lib-body">
        {renaming ? (
          <RenameInput title={p.title} className="lib-rename" onDone={onRename} />
        ) : (
          <a className="lib-title" href={`/p/${p.id}`} title={p.title} onClick={(e) => { e.preventDefault(); if (selecting) onToggle(e.shiftKey); else navigate(`/p/${p.id}`); }}>{p.title}</a>
        )}
        <span className="lib-meta muted small">
          {ui.label} · <span className="mono">{fmtSize(p.size)}</span>
        </span>
        <span className="lib-meta muted small">
          <span className="mono">{p.versionCount} {p.versionCount === 1 ? "version" : "versions"}</span> · {shortAgo(p.updatedAt)}
        </span>
        {seriesName && (
          <button type="button" className="series-chip" title="Show only this series" onClick={onSeries}>{seriesName}</button>
        )}
      </div>
    </li>
  );
}


/** An input that starts on the current title, selected, and saves on Enter or blur and cancels on Escape. */
export function RenameInput({ title, className, onDone }: { title: string; className: string; onDone: (title: string | null) => void }) {
  const [draft, setDraft] = useState(title);
  const finished = useRef(false);
  const done = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value);
  };
  return (
    <input
      ref={(el) => {
        if (el && document.activeElement !== el && !finished.current) {
          el.focus();
          el.select();
        }
      }}
      className={className}
      aria-label="Title"
      value={draft}
      maxLength={80}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => done(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          done(draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          done(null);
        }
      }}
    />
  );
}
