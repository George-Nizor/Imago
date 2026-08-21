import { useState } from 'react';
import {
  DEFAULT_THUMBNAIL_SIZE_ID,
  THUMBNAIL_SIZES,
  THUMBNAIL_TEMPLATES,
  type ThumbnailSizeId,
  type ThumbnailTemplate,
} from '../lib/templates';
import { useBrandStore } from '../store/brandStore';
import { useEditorStore } from '../store/editorStore';
import { Icon } from './Icon';
import { makeErrorNotice, reportDiagnostic } from '../lib/diagnostics';

export function StartScreen() {
  const brand = useBrandStore((state) => state.brand);
  const [sizeId, setSizeId] = useState<ThumbnailSizeId>(DEFAULT_THUMBNAIL_SIZE_ID);
  const startThumbnail = (templateId: string) => {
    try {
      useEditorStore.getState().newThumbnailFromTemplate(templateId, brand, sizeId);
    } catch (cause) {
      reportDiagnostic('ui', cause);
      useEditorStore
        .getState()
        .setNotice(makeErrorNotice('ui', 'The composition could not be created.', 'Try another template or canvas size.'));
    }
  };
  const startTitleCard = () => {
    try {
      useEditorStore.getState().newTitleCard(brand);
    } catch (cause) {
      reportDiagnostic('ui', cause);
      useEditorStore
        .getState()
        .setNotice(makeErrorNotice('ui', 'The title card could not be created.'));
    }
  };

  return (
    <main className="start-screen">
      <header className="start-header">
        <div className="start-lockup" aria-label="Imago home">
          <img src="./imago-mark.png" alt="" />
          <span>
            <strong>Imago</strong>
            <small>Instrumenta image</small>
          </span>
        </div>
        <div className="start-header-meta" aria-label="Local image compositor">
          <span className="local-dot" /> Local workspace
        </div>
      </header>

      <section className="template-browser" aria-labelledby="start-title">
        <div className="template-browser-head">
          <div>
            <span className="eyebrow">New thumbnail</span>
            <h1 id="start-title">Choose a composition</h1>
            <p>Pick the arrangement. Replace the pictures. Change the headline.</p>
          </div>

          <fieldset className="resolution-picker">
            <legend>Working canvas</legend>
            <div className="resolution-options">
              {THUMBNAIL_SIZES.map((size) => (
                <button
                  key={size.id}
                  type="button"
                  className={size.id === sizeId ? 'active' : ''}
                  aria-pressed={size.id === sizeId}
                  onClick={() => setSizeId(size.id)}
                >
                  <strong>{size.shortLabel}</strong>
                  <span>{size.width}×{size.height}</span>
                  {size.recommended && <em>Recommended output</em>}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="template-grid">
          {THUMBNAIL_TEMPLATES.map((template, index) => (
            <button
              className="template-card"
              type="button"
              key={template.id}
              onClick={() => startThumbnail(template.id)}
              aria-label={`Use ${template.name} template: ${template.description}`}
            >
              <TemplatePreview template={template} />
              <span className="template-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="template-card-copy">
                <strong>{template.name}</strong>
                <span>{template.description}</span>
                <em><Icon name="template" /> Use composition</em>
              </span>
            </button>
          ))}
        </div>
      </section>

      <footer className="start-footer">
        <button
          type="button"
          className="secondary-workflow"
          onClick={startTitleCard}
        >
          <Icon name="text" />
          <span><strong>Title card</strong><small>Transparent 1920×1080</small></span>
          <Icon name="next" />
        </button>
        <p><Icon name="sparkle" /> First cutout downloads the local-processing AI once; images stay on device.</p>
      </footer>
    </main>
  );
}

function TemplatePreview({ template }: { template: ThumbnailTemplate }) {
  const gradientId = `template-gradient-${template.id}`;
  return (
    <svg className="template-preview" viewBox="0 0 1280 720" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10191b" />
          <stop offset="0.56" stopColor="#29453f" />
          <stop offset="1" stopColor="#846f48" />
        </linearGradient>
        <filter id={`shadow-${template.id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" floodOpacity=".42" />
        </filter>
      </defs>
      <rect width="1280" height="720" fill={`url(#${gradientId})`} />
      <PreviewBackground kind={template.background} />
      {template.slots
        .filter((slot) => slot.kind !== 'background')
        .map((slot) => {
          const x = slot.box.x * 1280;
          const y = slot.box.y * 720;
          const width = slot.box.width * 1280;
          const height = slot.box.height * 720;
          if (slot.kind === 'subject') {
            return (
              <g key={slot.id} opacity=".96" filter={`url(#shadow-${template.id})`}>
                <ellipse
                  cx={x + width * 0.5}
                  cy={y + height * 0.25}
                  rx={Math.min(width, height) * 0.16}
                  ry={Math.min(width, height) * 0.18}
                  fill="#d8ddd7"
                  stroke="#f0ede6"
                  strokeWidth="10"
                />
                <path
                  d={`M ${x + width * 0.14} ${y + height} Q ${x + width * 0.2} ${y + height * 0.43} ${x + width * 0.5} ${y + height * 0.4} Q ${x + width * 0.8} ${y + height * 0.43} ${x + width * 0.86} ${y + height} Z`}
                  fill="#729488"
                  stroke="#f0ede6"
                  strokeWidth="10"
                />
              </g>
            );
          }
          if (slot.shape === 'circle') {
            return (
              <g key={slot.id} opacity=".92">
                <circle cx={x + width / 2} cy={y + height / 2} r={Math.min(width, height) * 0.42} fill="#b89c67" />
                <circle cx={x + width / 2} cy={y + height / 2} r={Math.min(width, height) * 0.25} fill="#f0ede6" opacity=".65" />
              </g>
            );
          }
          return (
            <g key={slot.id} opacity=".88">
              <rect x={x} y={y} width={width} height={height} rx="18" fill="#132526" stroke="#91aca3" strokeWidth="5" />
              <circle cx={x + width * 0.72} cy={y + height * 0.28} r={Math.min(width, height) * 0.09} fill="#b89c67" />
              <path d={`M${x} ${y + height * 0.82} ${x + width * 0.32} ${y + height * 0.48} ${x + width * 0.55} ${y + height * 0.68} ${x + width * 0.75} ${y + height * 0.4} ${x + width} ${y + height * 0.74}V${y + height}H${x}Z`} fill="#52776e" />
            </g>
          );
        })}
      <text
        x={template.title.x * 1280}
        y={template.title.y * 720}
        textAnchor={template.title.align === 'center' ? 'middle' : template.title.align === 'right' ? 'end' : 'start'}
        dominantBaseline="middle"
        fill="#f0ede6"
        stroke="#0e0b13"
        strokeWidth="11"
        paintOrder="stroke"
        fontFamily="Arial Black, sans-serif"
        fontWeight="900"
        fontSize={Math.min(96, template.title.fontSize * 720)}
      >
        {template.title.text}
      </text>
    </svg>
  );
}

function PreviewBackground({ kind }: { kind: ThumbnailTemplate['background'] }) {
  if (kind === 'split') {
    return <path d="M640 0h640v720H510Z" fill="#b89c67" opacity=".38" />;
  }
  if (kind === 'panels') {
    return <path d="M720-80h250L690 800H440Z" fill="#b89c67" opacity=".28" />;
  }
  if (kind === 'radial' || kind === 'punch') {
    return <circle cx="640" cy="340" r="330" fill="#8db3a7" opacity=".2" />;
  }
  if (kind === 'wash') {
    return <path d="M0 520Q350 260 680 420t600-170v470H0Z" fill="#729488" opacity=".25" />;
  }
  return <path d="M0 0h1280L890 720H0Z" fill="#729488" opacity=".16" />;
}
