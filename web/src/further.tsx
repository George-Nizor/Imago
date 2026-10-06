import type { FurtherModel, Project } from "./api/types.js";
import { Icon } from "./brand/Icon.js";
import { FURTHER_MODELS, modelLabel, stockCredits, useFurtherModel } from "./further-lib.js";

/** The "Take it further" button, its model choice and a one-line hint. */
export function FurtherBar({ hasNote, disabled, onGo }: { hasNote: boolean; disabled: boolean; onGo: (model: FurtherModel) => void }) {
  const [model, setModel] = useFurtherModel();
  return (
    <div className="further">
      <div className="further-row">
        <button
          type="button"
          className="further-btn"
          disabled={disabled}
          onClick={() => onGo(model)}
          title={hasNote ? "Run a stronger model with your note as the direction" : "Run a stronger model with full creative freedom"}
        >
          <Icon name="sparkle" size={20} />
          <span>Take it further</span>
        </button>
        <div className="seg further-seg mono" role="radiogroup" aria-label="Model for Take it further">
          {FURTHER_MODELS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={model === m.id} className={model === m.id ? "on" : ""} onClick={() => setModel(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <p className="further-hint small muted">
        Uses a stronger model and can source stock images. {model === "fable" ? "Fable 5.1 uses the most of your Claude plan." : "Uses more of your Claude plan."}
        {hasNote ? " Your note becomes the direction." : ""}
      </p>
    </div>
  );
}

export function ModelBadge({ model }: { model: string }) {
  return (
    <span className="model-badge mono" title={`Made with ${modelLabel(model)}`}>
      <Icon name="sparkle" size={14} /> {modelLabel(model)}
    </span>
  );
}

/** A small disclosure under the preview listing the stock images the project holds. */
export function Credits({ project }: { project: Project }) {
  const credits = stockCredits(project);
  if (!credits.length) return null;
  return (
    <details className="credits">
      <summary className="small muted">Image credits ({credits.length})</summary>
      <ul className="small">
        {credits.map((c) => (
          <li key={c.name}>
            <span className="mono">{c.name}</span> by {c.credit || "unknown"}
            {c.license && (
              <>
                {" "}
                {/^https?:\/\//i.test(c.licenseUrl) ? <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer">{c.license}</a> : c.license}
              </>
            )}
            {c.source ? ` · ${c.source}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
