import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/index.js";
import { BRAND_ASSET_KINDS, BRAND_ROLES, type Brand, type BrandAssetKind, type BrandColour, type BrandFont, type BrandRole, type FontCatalog, type FontFamily } from "../api/types.js";
import { Btn } from "../components.js";
import { Icon } from "../brand/Icon.js";
import { useToast } from "../library/hooks.js";
import { Dialog } from "../library/ui.js";
import { errorText } from "../lib.js";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FONT_SHEET = "/fonts/fonts.css";
const ROLE_HINT: Record<BrandRole, string> = {
  primary: "the main colour",
  accent: "the pop",
  ink: "dark: type and deep grounds",
  light: "light: type on dark, paper",
  extra: "supporting, sparingly",
};

/** The content fonts (every family a design may use) for the specimens; the sheet is only needed on this page. */
function useContentFonts() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_SHEET;
    document.head.append(link);
    return () => link.remove();
  }, []);
}

const fontCss = (f: BrandFont | undefined): React.CSSProperties =>
  f ? { fontFamily: `"${f.family}", serif`, ...(f.weight ? { fontWeight: f.weight } : {}), ...(f.settings ? { fontVariationSettings: f.settings } : {}) } : {};

const lum = (hex: string) => {
  const h = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const readable = (bg: string) => (lum(bg) > 0.45 ? "#111111" : "#ffffff");
const byRole = (colours: BrandColour[], role: BrandRole) => colours.find((c) => c.role === role && HEX.test(c.hex))?.hex;

/** A sample 16:9 thumbnail in the brand's colours and type, so the owner sees it before using it. */
export function BrandPreview({ colours, fonts, name }: { colours: BrandColour[]; fonts: Brand["fonts"]; name: string }) {
  const valid = colours.filter((c) => HEX.test(c.hex));
  const ground = byRole(valid, "ink") ?? byRole(valid, "primary") ?? valid[0]?.hex ?? "#222222";
  const primary = byRole(valid, "primary") ?? valid[0]?.hex ?? "#00bcab";
  const accent = byRole(valid, "accent") ?? byRole(valid, "extra") ?? primary;
  const text = byRole(valid, "light") ?? readable(ground);
  return (
    <div className="brand-preview" style={{ background: ground, color: text }} role="img" aria-label={`Sample thumbnail in the ${name || "brand"} colours and type`}>
      <span className="bp-blob" style={{ background: primary }} />
      <span className="bp-ring" style={{ borderColor: accent }} />
      <div className="bp-text">
        <span className="bp-tag" style={{ ...fontCss(fonts.mono ?? fonts.support), background: accent, color: readable(accent) }}>EP 12</span>
        <span className="bp-title" style={fontCss(fonts.display)}>It finally works</span>
        <span className="bp-sub" style={fontCss(fonts.support)}>Three days, one garage, a rocket</span>
        <span className="bp-bar" style={{ background: accent }} />
      </div>
    </div>
  );
}

function Swatches({ colours }: { colours: BrandColour[] }) {
  return (
    <ul className="swatches" aria-label="Colours">
      {colours.map((c, i) => (
        <li key={i} title={`${c.name} ${c.hex} (${c.role})`}>
          <span className="swatch" style={{ background: HEX.test(c.hex) ? c.hex : "transparent" }} />
        </li>
      ))}
    </ul>
  );
}

// ---- the editor's working copy: devices are lines of text until it is saved ----
interface Draft {
  id: string | null;
  name: string;
  description: string;
  colours: BrandColour[];
  fonts: { display: BrandFont; support: BrandFont; mono: BrandFont | null };
  devices: string;
  guidance: string;
  isDefault: boolean;
}
const blank = (): Draft => ({
  id: null,
  name: "",
  description: "",
  colours: [
    { name: "Primary", hex: "#00bcab", role: "primary" },
    { name: "Ink", hex: "#111418", role: "ink" },
    { name: "Light", hex: "#ffffff", role: "light" },
  ],
  fonts: { display: { family: "Fraunces", weight: 800 }, support: { family: "Commissioner", weight: 500 }, mono: null },
  devices: "",
  guidance: "",
  isDefault: false,
});
const draftOf = (b: Brand): Draft => ({
  id: b.id,
  name: b.name,
  description: b.description,
  colours: structuredClone(b.colours),
  fonts: { display: { ...b.fonts.display }, support: { ...b.fonts.support }, mono: b.fonts.mono ? { ...b.fonts.mono } : null },
  devices: b.devices.join("\n"),
  guidance: b.guidance,
  isDefault: b.isDefault,
});
const bodyOf = (d: Draft) => {
  const clean = (f: BrandFont): BrandFont => ({ family: f.family, ...(f.weight ? { weight: f.weight } : {}), ...(f.settings?.trim() ? { settings: f.settings.trim() } : {}) });
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    colours: d.colours.map((c) => ({ ...c, name: c.name.trim() || c.hex })),
    fonts: { display: clean(d.fonts.display), support: clean(d.fonts.support), ...(d.fonts.mono ? { mono: clean(d.fonts.mono) } : {}) },
    devices: d.devices.split("\n").map((l) => l.trim()).filter(Boolean),
    guidance: d.guidance.trim(),
    isDefault: d.isDefault,
  };
};

export function Brands() {
  useContentFonts();
  const toast = useToast();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [fonts, setFonts] = useState<FontCatalog | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Brand | null>(null);

  const refresh = useCallback(() => api.listBrands().then((l) => (setBrands(l.items), setError(""))).catch((e) => setError(errorText(e))), []);
  useEffect(() => {
    void refresh();
    api.listFonts().then(setFonts).catch((e) => setError(errorText(e)));
  }, [refresh]);

  async function makeDefault(b: Brand) {
    try {
      await api.updateBrand(b.id, { isDefault: !b.isDefault });
      await refresh();
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.deleteBrand(deleting.id);
      toast(`Deleted “${deleting.name}”. Projects made with it keep their copy.`);
      setDeleting(null);
      if (draft?.id === deleting.id) setDraft(null);
      await refresh();
    } catch (e) {
      toast(errorText(e));
      setDeleting(null);
    }
  }

  if (draft && fonts) return <Editor draft={draft} setDraft={setDraft} fonts={fonts} brands={brands ?? []} onClose={() => { setDraft(null); void refresh(); }} onDelete={(b) => setDeleting(b)} deleting={deleting} confirmDelete={confirmDelete} cancelDelete={() => setDeleting(null)} />;

  return (
    <div className="page brands">
      <div className="lib-head">
        <h1 className="display">Brands</h1>
        {brands && brands.length > 0 && <span className="muted">{brands.length} {brands.length === 1 ? "brand" : "brands"}</span>}
        <span className="spacer" />
        <Btn variant="primary" icon="sparkle" onClick={() => setDraft(blank())} disabled={!fonts}>New brand</Btn>
      </div>
      <p className="lede">A brand is a reusable look: colours, fonts and a few signature touches. It fixes type and colour only; layout, composition and pictures stay free. Pick one when you start a design.</p>
      {error && <p className="banner-error" role="alert">{error}</p>}

      {brands && brands.length === 0 && (
        <section className="lib-empty">
          <Icon name="sparkle" size={56} />
          <h2 className="display">No brands yet</h2>
          <p className="muted">Make one for a channel or a client and every design can start in its colours and type.</p>
          <Btn variant="primary" onClick={() => setDraft(blank())} disabled={!fonts}>Make your first brand</Btn>
        </section>
      )}

      <ul className="brand-grid">
        {brands?.map((b) => (
          <li key={b.id} className="brand-card">
            <BrandPreview colours={b.colours} fonts={b.fonts} name={b.name} />
            <div className="brand-card-body">
              <div className="brand-card-title">
                <h2 className="display" style={fontCss(b.fonts.display)}>{b.name}</h2>
                {b.isDefault && <span className="series-chip static">Default</span>}
              </div>
              <Swatches colours={b.colours} />
              <p className="specimen" style={fontCss(b.fonts.support)}>
                <span style={fontCss(b.fonts.display)}>Aa</span> The quick brown fox jumps over 1234
              </p>
              <p className="muted small mono">{b.fonts.display.family} · {b.fonts.support.family}{b.fonts.mono ? ` · ${b.fonts.mono.family}` : ""}</p>
              <div className="brand-card-actions">
                <Btn variant="primary" onClick={() => setDraft(draftOf(b))}>Edit</Btn>
                <Btn onClick={() => void makeDefault(b)}>{b.isDefault ? "Not the default" : "Set as default"}</Btn>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {deleting && <ConfirmDelete brand={deleting} onYes={confirmDelete} onNo={() => setDeleting(null)} />}
    </div>
  );
}

function ConfirmDelete({ brand, onYes, onNo }: { brand: Brand | { name: string }; onYes: () => void; onNo: () => void }) {
  return (
    <Dialog title={`Delete “${brand.name}”?`} onClose={onNo}>
      <p>Projects already made with it keep their own copy of its colours and fonts. This cannot be undone.</p>
      <div className="dialog-actions">
        <span className="spacer" />
        <Btn onClick={onNo}>Keep it</Btn>
        <Btn variant="danger" onClick={onYes}>Delete</Btn>
      </div>
    </Dialog>
  );
}

function familyAxes(f: FontFamily | undefined): string {
  if (!f) return "";
  const parts = Object.entries(f.axes ?? {}).map(([tag, [lo, hi]]) => `"${tag}" ${lo}–${hi}`);
  if (f.variable) parts.unshift(`weight ${Math.min(...f.weights)}–${Math.max(...f.weights)}`);
  else parts.unshift(`weight ${f.weights.join(", ")}`);
  if (f.stretch) parts.push(`width ${f.stretch[0]}–${f.stretch[1]}%`);
  return parts.join(" · ");
}

function FontRow({ slot, label, value, onChange, catalog, optional }: { slot: string; label: string; value: BrandFont | null; onChange: (f: BrandFont | null) => void; catalog: FontCatalog; optional?: boolean }) {
  const family = value ? catalog.families.find((f) => f.family === value.family) : undefined;
  return (
    <div className="font-row">
      <div className="font-fields">
        <label className="field">
          <span className="label">{label}</span>
          <select aria-label={`${label} font`} value={value?.family ?? ""} onChange={(e) => onChange(e.target.value ? { family: e.target.value, ...(value?.weight ? { weight: value.weight } : {}) } : null)}>
            {optional && <option value="">None</option>}
            {catalog.families.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
          </select>
        </label>
        {value && (
          <>
            <label className="field narrow">
              <span className="label">Weight</span>
              <input aria-label={`${label} weight`} className="mono" inputMode="numeric" placeholder="400" value={value.weight ?? ""} onChange={(e) => onChange({ ...value, weight: e.target.value ? Number(e.target.value.replace(/\D/g, "")) || undefined : undefined })} />
            </label>
            <label className="field grow">
              <span className="label">Settings <em>font-variation-settings</em></span>
              <input aria-label={`${label} settings`} className="mono" placeholder={'"SOFT" 100, "WONK" 1'} value={value.settings ?? ""} onChange={(e) => onChange({ ...value, settings: e.target.value })} />
            </label>
          </>
        )}
      </div>
      {value && (
        <>
          <p className="specimen live" data-slot={slot} style={fontCss(value)}>Rockets, receipts &amp; 0123456789 — Aa Gg</p>
          {familyAxes(family) && <p className="muted small mono">{familyAxes(family)}</p>}
        </>
      )}
    </div>
  );
}

function Editor({ draft, setDraft, fonts, brands, onClose, onDelete, deleting, confirmDelete, cancelDelete }: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  fonts: FontCatalog;
  brands: Brand[];
  onClose: () => void;
  onDelete: (b: Brand) => void;
  deleting: Brand | null;
  confirmDelete: () => void;
  cancelDelete: () => void;
}) {
  const toast = useToast();
  const [saved, setSaved] = useState<Brand | null>(() => brands.find((b) => b.id === draft.id) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<BrandAssetKind>("logo");
  const [note, setNote] = useState("");
  const set = (patch: Partial<Draft>) => {
    setDirty(true);
    setDraft({ ...draft, ...patch });
  };
  const setColour = (i: number, patch: Partial<BrandColour>) => set({ colours: draft.colours.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const move = (i: number, by: -1 | 1) => {
    const to = i + by;
    if (to < 0 || to >= draft.colours.length) return;
    const next = [...draft.colours];
    [next[i], next[to]] = [next[to]!, next[i]!];
    set({ colours: next });
  };
  const badHex = draft.colours.some((c) => !HEX.test(c.hex.trim()));
  const valid = draft.name.trim().length > 0 && draft.colours.length > 0 && !badHex;
  const previewFonts = useMemo(() => ({ display: draft.fonts.display, support: draft.fonts.support, ...(draft.fonts.mono ? { mono: draft.fonts.mono } : {}) }), [draft.fonts]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body = bodyOf(draft);
      const brand = draft.id ? await api.updateBrand(draft.id, body) : await api.createBrand(body);
      setSaved(brand);
      setDraft({ ...draft, id: brand.id, isDefault: brand.isDefault });
      setDirty(false);
      toast(draft.id ? "Saved." : "Brand created. You can add a logo or mascot now.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function addFiles(files: File[]) {
    if (!saved) return;
    setError("");
    for (const f of files) {
      try {
        await api.uploadBrandAsset(saved.id, f, { kind, note: note.trim() });
      } catch (e) {
        setError(`${f.name}: ${errorText(e)}`);
      }
    }
    setNote("");
    setSaved(await api.listBrands().then((l) => l.items.find((b) => b.id === saved.id) ?? saved));
  }
  async function patchAsset(name: string, patch: { kind?: BrandAssetKind; note?: string }) {
    if (!saved) return;
    try {
      await api.updateBrandAsset(saved.id, name, patch);
      setSaved(await api.listBrands().then((l) => l.items.find((b) => b.id === saved.id) ?? saved));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function dropAsset(name: string) {
    if (!saved) return;
    try {
      await api.deleteBrandAsset(saved.id, name);
      setSaved(await api.listBrands().then((l) => l.items.find((b) => b.id === saved.id) ?? saved));
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="page brands">
      <a className="back" href="/brands" onClick={(e) => { e.preventDefault(); onClose(); }}>← All brands</a>
      <div className="lib-head">
        <h1 className="display">{draft.id ? draft.name || "Brand" : "New brand"}</h1>
        {dirty && <span className="muted small">Unsaved changes</span>}
      </div>
      <div className="brand-editor">
        <form className="form brand-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void save(); }}>
          <fieldset disabled={busy} className="fields">
            <label className="field">
              <span className="label">Name</span>
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="My channel" maxLength={60} autoFocus />
            </label>
            <label className="field">
              <span className="label">Description <em>optional</em></span>
              <textarea rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Who it is for and how it should feel." />
            </label>

            <div className="field">
              <span className="label">Colours <em>the core palette; tints, shades, black and white are always allowed</em></span>
              <ul className="colour-rows">
                {draft.colours.map((c, i) => (
                  <li key={i} className="colour-row">
                    <input type="color" aria-label={`Colour ${i + 1} picker`} value={HEX.test(c.hex) ? (c.hex.length === 4 ? `#${[...c.hex.slice(1)].map((x) => x + x).join("")}` : c.hex.toLowerCase()) : "#000000"} onChange={(e) => setColour(i, { hex: e.target.value.toUpperCase() })} />
                    <input aria-label={`Colour ${i + 1} hex`} className={`mono hex ${HEX.test(c.hex.trim()) ? "" : "bad"}`} value={c.hex} onChange={(e) => setColour(i, { hex: e.target.value.trim() })} maxLength={7} aria-invalid={!HEX.test(c.hex.trim())} />
                    <input aria-label={`Colour ${i + 1} name`} value={c.name} onChange={(e) => setColour(i, { name: e.target.value })} placeholder="Name" maxLength={40} />
                    <select aria-label={`Colour ${i + 1} role`} value={c.role} onChange={(e) => setColour(i, { role: e.target.value as BrandRole })} title={ROLE_HINT[c.role]}>
                      {BRAND_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <span className="colour-actions">
                      <button type="button" className="icon-btn small" aria-label={`Move colour ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button type="button" className="icon-btn small" aria-label={`Move colour ${i + 1} down`} disabled={i === draft.colours.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button type="button" className="icon-btn small" aria-label={`Remove colour ${i + 1}`} disabled={draft.colours.length <= 1} onClick={() => set({ colours: draft.colours.filter((_, j) => j !== i) })}>✕</button>
                    </span>
                  </li>
                ))}
              </ul>
              {badHex && <p className="field-error" role="alert">Every colour needs a hex value such as #00BCAB.</p>}
              <div><Btn onClick={() => set({ colours: [...draft.colours, { name: "", hex: "#888888", role: "extra" }] })} disabled={draft.colours.length >= 12}>Add a colour</Btn></div>
            </div>

            <div className="field">
              <span className="label">Fonts <em>weight and settings are written into the design as given</em></span>
              <FontRow slot="display" label="Display" value={draft.fonts.display} catalog={fonts} onChange={(f) => f && set({ fonts: { ...draft.fonts, display: f } })} />
              <FontRow slot="support" label="Support" value={draft.fonts.support} catalog={fonts} onChange={(f) => f && set({ fonts: { ...draft.fonts, support: f } })} />
              <FontRow slot="mono" label="Mono" optional value={draft.fonts.mono} catalog={fonts} onChange={(f) => set({ fonts: { ...draft.fonts, mono: f } })} />
            </div>

            <label className="field">
              <span className="label">Signature devices <em>one per line</em></span>
              <textarea rows={3} value={draft.devices} onChange={(e) => set({ devices: e.target.value })} placeholder={"A thick underline under the key word\nSoft rounded corners"} />
            </label>
            <label className="field">
              <span className="label">Guidance <em>optional</em></span>
              <textarea rows={4} value={draft.guidance} onChange={(e) => set({ guidance: e.target.value })} placeholder="Tone, do and don't, anything the colours and fonts do not say." />
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} />
              <span>Use this brand by default <span className="muted">(preselected when you start a design)</span></span>
            </label>
          </fieldset>

          {error && <p className="banner-error" role="alert">{error}</p>}
          <div className="form-actions">
            <Btn type="submit" variant="primary" disabled={!valid || busy}>{busy ? "Saving…" : draft.id ? "Save changes" : "Create brand"}</Btn>
            {draft.id && saved && <Btn variant="danger" onClick={() => onDelete(saved)}>Delete brand</Btn>}
          </div>
        </form>

        <aside className="brand-side">
          <div className="brand-sticky">
            <span className="label">Preview</span>
            <BrandPreview colours={draft.colours} fonts={previewFonts} name={draft.name} />
            <Swatches colours={draft.colours} />
            <section className="brand-assets" aria-label="Logo and mascot files">
              <span className="label">Logo and mascot <em>optional files Claude may use</em></span>
              {!saved ? (
                <p className="muted small">Create the brand first, then add files here.</p>
              ) : (
                <>
                  <ul className="asset-list">
                    {saved.assets.map((a) => (
                      <li key={a.name}>
                        <img src={a.url} alt="" width={56} height={56} />
                        <div className="asset-meta">
                          <span className="mono small">{a.name} · {a.width}×{a.height}</span>
                          <select aria-label={`${a.name} kind`} value={a.kind} onChange={(e) => void patchAsset(a.name, { kind: e.target.value as BrandAssetKind })}>
                            {BRAND_ASSET_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                          <input aria-label={`${a.name} note`} defaultValue={a.note} placeholder="Note, e.g. use on dark grounds" maxLength={240} onBlur={(e) => e.target.value !== a.note && void patchAsset(a.name, { note: e.target.value })} />
                        </div>
                        <button type="button" className="icon-btn small" aria-label={`Remove ${a.name}`} onClick={() => void dropAsset(a.name)}>✕</button>
                      </li>
                    ))}
                  </ul>
                  <div className="asset-add">
                    <select aria-label="Kind of the new file" value={kind} onChange={(e) => setKind(e.target.value as BrandAssetKind)}>
                      {BRAND_ASSET_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input aria-label="Note for the new file" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={240} />
                    <Btn onClick={() => input.current?.click()}>Add a file</Btn>
                    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
                  </div>
                  <p className="muted small">PNG, JPEG or WebP.</p>
                </>
              )}
            </section>
          </div>
        </aside>
      </div>
      {deleting && <ConfirmDelete brand={deleting} onYes={confirmDelete} onNo={cancelDelete} />}
    </div>
  );
}
