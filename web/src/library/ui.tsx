import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api/index.js";
import type { Series } from "../api/types.js";
import { Btn } from "../components.js";
import { errorText } from "../lib.js";
import { type Toast, ToastContext, type Notify } from "./hooks.js";

// ---- glyphs: plain strokes in currentColor, for controls that the brand icon set has no mark for ----
type GlyphName = "star" | "star-fill" | "more" | "trash" | "search" | "check";
const GLYPHS: Record<GlyphName, string> = {
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  "star-fill": '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  more: '<circle cx="5.5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="18.5" cy="12" r="1.9" fill="currentColor"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
};
export function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
  // Fixed strings above, never user input.
  return <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS[name] }} />;
}

// ---- menu button: focus moves into the menu, arrows move, Escape closes and returns focus ----
export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a rule above the item. */
  divider?: boolean;
}

export function MenuButton({ label, items, className = "" }: { label: string; items: MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const r = trigger.current?.getBoundingClientRect();
    setUp(Boolean(r && r.bottom + 290 > window.innerHeight && r.top > 290));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const at = els.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      els[(i + els.length) % els.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(els.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className={`menu-wrap ${className}`} ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="icon-btn menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Glyph name="more" size={22} />
      </button>
      {open && (
        <div id={id} ref={menu} role="menu" aria-label={label} className={`menu ${up ? "up" : ""}`} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`menu-item ${item.danger ? "danger" : ""} ${item.divider ? "divider" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                // Focus goes back to the trigger first, so a dialog opened next returns focus there when it closes.
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- modal dialog with a focus trap; Escape and the scrim close it ----
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("input, button, select, textarea");
    first?.focus();
    return () => before?.focus?.();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      const els = [...(box.current?.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled]), select, textarea") ?? [])];
      if (!els.length) return;
      const first = els[0]!;
      const last = els.at(-1)!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box} onKeyDown={onKey}>
        <h2 id={titleId} className="display">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const drop = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const notify = useCallback<Notify>(
    (text, action, ms = 6000) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-2), { id, text, action }]);
      setTimeout(() => drop(id), ms);
    },
    [drop],
  );
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  drop(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Pick a series for some projects, or make a new one. `onPick(null)` takes them out of any series. */
export function SeriesDialog({
  count,
  current,
  series,
  onPick,
  onClose,
}: {
  count: number;
  current?: string | null;
  series: Series[];
  onPick: (id: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<string>(current ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fresh = choice === "__new";
  const ok = !busy && (!fresh || name.trim().length > 0);
  async function save() {
    setBusy(true);
    setError("");
    try {
      let id: string | null = choice || null;
      if (fresh) id = (await api.createSeries(name.trim())).id;
      await onPick(id);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog title={count > 1 ? `Move ${count} designs to a series` : "Move to a series"} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) void save();
        }}
      >
        <p className="muted small">A series keeps a channel's thumbnails looking like one family.</p>
        <fieldset className="radios">
          <legend className="sr-only">Series</legend>
          <label className="radio"><input type="radio" name="series" checked={choice === ""} onChange={() => setChoice("")} /> No series</label>
          {series.map((s) => (
            <label key={s.id} className="radio">
              <input type="radio" name="series" checked={choice === s.id} onChange={() => setChoice(s.id)} /> {s.name} <span className="muted mono small">{s.count ?? 0}</span>
            </label>
          ))}
          <label className="radio"><input type="radio" name="series" checked={fresh} onChange={() => setChoice("__new")} /> New series…</label>
        </fieldset>
        {fresh && <input aria-label="New series name" placeholder="Series name, for example the channel" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}
        {error && <p className="banner-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={!ok}>{busy ? "Moving…" : "Move"}</Btn>
        </div>
      </form>
    </Dialog>
  );
}

/** The start form's optional series: none, one that exists, or a new one named here. */
export function SeriesField({
  series,
  choice,
  name,
  onChoice,
  onName,
}: {
  series: Series[];
  choice: string;
  name: string;
  onChoice: (id: string) => void;
  onName: (name: string) => void;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor="series-pick">Series <em>optional, keeps a channel's thumbnails looking alike</em></label>
      <select id="series-pick" className="size-select" value={choice} onChange={(e) => onChoice(e.target.value)}>
        <option value="">No series</option>
        {series.map((s) => <option key={s.id} value={s.id}>{s.name}{s.styleProjectId ? " (has a style reference)" : ""}</option>)}
        <option value="__new">New series…</option>
      </select>
      {choice === "__new" && <input aria-label="New series name" placeholder="Name it after the channel" maxLength={60} value={name} onChange={(e) => onName(e.target.value)} />}
    </div>
  );
}
