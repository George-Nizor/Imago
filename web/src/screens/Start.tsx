import { useEffect, useState } from "react";
import { api } from "../api/index.js";
import type { PresetInfo, ProjectSummary } from "../api/types.js";
import { canCreate, useCaps } from "../caps.js";
import { Icon } from "../brand/Icon.js";
import { CapabilityPanel } from "../components.js";
import { ago, errorText, navigate } from "../lib.js";
import { PRESET_UI } from "../presets.js";

export function Start() {
  const { caps, error, checking, recheck } = useCaps();
  const [recent, setRecent] = useState<ProjectSummary[] | null>(null);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [loadError, setLoadError] = useState("");
  const ok = canCreate(caps);

  useEffect(() => {
    api.listProjects().then(setRecent).catch((e) => {
      setRecent([]);
      setLoadError(errorText(e));
    });
    api.presets().then(setPresets).catch(() => {});
  }, []);

  return (
    <div className="page start">
      <div className="hero">
        <img src="/brand/imago.svg" alt="" width={84} height={84} />
        <div>
          <h1 className="display">Imago</h1>
          <p className="lede">Tell Claude what you need. It designs it, you steer.</p>
        </div>
      </div>

      {error && <p className="banner-error" role="alert">{error}</p>}
      {caps && !ok && <CapabilityPanel caps={caps} checking={checking} onRecheck={recheck} />}

      <h2 className="section-title display">What are we making?</h2>
      <div className="preset-grid">
        {PRESET_UI.map((p) => {
          const info = presets.find((x) => x.id === p.id);
          return (
            <a
              key={p.id}
              href={`/new/${p.id}`}
              className="preset-card"
              aria-disabled={!ok}
              onClick={(e) => {
                e.preventDefault();
                if (ok) navigate(`/new/${p.id}`);
              }}
            >
              <Icon name={p.icon} size={64} />
              <h3 className="display">{info?.label ?? p.label}</h3>
              <p>{info?.description ?? p.blurb}</p>
              {info?.defaultSize && <span className="mono muted">{info.defaultSize.width} × {info.defaultSize.height}</span>}
            </a>
          );
        })}
      </div>

      <h2 className="section-title display">Recent</h2>
      {recent === null ? (
        <p className="muted">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="muted">{loadError || "Nothing yet. Your designs will show up here."}</p>
      ) : (
        <ul className="recent-grid">
          {recent.map((p) => (
            <li key={p.id}>
              <a
                href={`/p/${p.id}`}
                className="recent-card"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/p/${p.id}`);
                }}
              >
                <span className="recent-thumb">
                  {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" /> : <Icon name={PRESET_UI.find((x) => x.id === p.preset)?.icon ?? "graphic"} size={40} />}
                </span>
                <span className="recent-title">{p.title}</span>
                <span className="muted small">{PRESET_UI.find((x) => x.id === p.preset)?.label} · {ago(p.updatedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
