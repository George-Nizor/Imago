import { useEditorStore, getSelectedLayer } from '../store/editorStore';
import { useBrandStore } from '../store/brandStore';
import { usePrefsStore } from '../store/prefsStore';
import { BACKGROUND_VARIANTS } from '../lib/backgrounds';
import { applyBeautyPass } from '../lib/beauty';
import { loadImage } from '../lib/imageUtils';
import { bakeGrade } from '../lib/grade';
import { TEXT_EFFECT_PRESETS, applyTextPreset } from '../lib/textEffects';
import type { BackgroundVariantKind, ImageLayer, TextLayer } from '../types/document';

export function PropertiesPanel() {
  const doc = useEditorStore((s) => s.doc);
  const tool = useEditorStore((s) => s.tool);
  const brand = useBrandStore((s) => s.brand);
  const setBrand = useBrandStore((s) => s.setBrand);
  const layer = getSelectedLayer(doc);

  if (!doc) return null;

  return (
    <div className="panel props-panel">
      <h3>Properties</h3>

      {(!layer || tool === 'beauty') && tool === 'beauty' && (
        <BeautyControls />
      )}

      {layer?.type === 'background' && (
        <div className="props-block">
          <label>Background style</label>
          <div className="bg-variants">
            {BACKGROUND_VARIANTS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={layer.variant === v.id ? 'active' : ''}
                onClick={() => {
                  usePrefsStore.getState().set({ lastBgVariant: v.id });
                  useEditorStore.getState().setBackgroundVariant(v.id as BackgroundVariantKind, brand);
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => useEditorStore.getState().rerollBackground(brand)}
          >
            Reroll variant
          </button>
        </div>
      )}

      {layer?.type === 'image' && <ImageProps layer={layer} />}
      {layer?.type === 'text' && <TextProps layer={layer} />}

      <div className="props-block brand-block">
        <h4>Brand kit</h4>
        <label>
          Primary
          <input
            type="color"
            value={brand.primary}
            onChange={(e) => setBrand({ primary: e.target.value })}
          />
        </label>
        <label>
          Accent
          <input
            type="color"
            value={brand.accent}
            onChange={(e) => setBrand({ accent: e.target.value })}
          />
        </label>
        <label>
          Text fill
          <input
            type="color"
            value={brand.textFill}
            onChange={(e) => setBrand({ textFill: e.target.value })}
          />
        </label>
        <label>
          Text stroke
          <input
            type="color"
            value={brand.textStroke}
            onChange={(e) => setBrand({ textStroke: e.target.value })}
          />
        </label>
        <label>
          Outline color
          <input
            type="color"
            value={brand.subjectOutlineColor}
            onChange={(e) => setBrand({ subjectOutlineColor: e.target.value })}
          />
        </label>
        <label>
          Font
          <select
            value={brand.fontFamily}
            onChange={(e) => setBrand({ fontFamily: e.target.value })}
          >
            <option value='"Playfair Display", Georgia, serif'>Playfair Display</option>
            <option value='"Cinzel", Georgia, serif'>Cinzel</option>
            <option value='"Bebas Neue", sans-serif'>Bebas Neue</option>
            <option value='"Anton", sans-serif'>Anton</option>
            <option value='"Oswald", sans-serif'>Oswald</option>
            <option value='"Archivo Black", Impact, sans-serif'>Archivo Black</option>
            <option value='"DM Serif Display", Georgia, serif'>DM Serif Display</option>
            <option value="Impact, Haettenschweiler, Arial Black, sans-serif">Impact</option>
          </select>
        </label>
        <label>
          Title size
          <input
            type="number"
            value={brand.titleSize}
            onChange={(e) => setBrand({ titleSize: Number(e.target.value) })}
          />
        </label>
        <label>
          Stroke width
          <input
            type="number"
            value={brand.textStrokeWidth}
            onChange={(e) => setBrand({ textStrokeWidth: Number(e.target.value) })}
          />
        </label>
        <button
          type="button"
          onClick={() => useEditorStore.getState().applyBrandToDoc(brand)}
        >
          Apply to document
        </button>
        {layer?.type === 'text' && (
          <button
            type="button"
            onClick={() => {
              setBrand({
                textFill: layer.fill,
                textStroke: layer.stroke,
                textStrokeWidth: layer.strokeWidth,
                fontFamily: layer.fontFamily,
                fontWeight: layer.fontWeight,
                titleSize: layer.fontSize,
                shadowBlur: layer.shadowBlur,
                shadowColor: layer.shadowColor,
              });
            }}
          >
            Save text as brand
          </button>
        )}
      </div>
    </div>
  );
}

function BeautyControls() {
  const prefs = usePrefsStore();
  const layer = getSelectedLayer(useEditorStore((s) => s.doc));

  return (
    <div className="props-block">
      <h4>Beauty</h4>
      <label>
        Amount (one-click)
        <input
          type="range"
          min={0}
          max={100}
          value={prefs.beautyDefault}
          onChange={(e) => prefs.set({ beautyDefault: Number(e.target.value) })}
        />
        <span>{prefs.beautyDefault}</span>
      </label>
      <button
        type="button"
        disabled={!layer || layer.type !== 'image'}
        onClick={async () => {
          if (!layer || layer.type !== 'image') return;
          const store = useEditorStore.getState();
          store.pushHistory();
          store.setBusy('Beauty pass…');
          try {
            const src = await applyBeautyPass(layer.src, {
              ...layer.beauty,
              amount: prefs.beautyDefault,
            });
            const img = await loadImage(src);
            store.replaceImageSrc(layer.id, src, {
              w: img.naturalWidth,
              h: img.naturalHeight,
            });
          } finally {
            store.setBusy(null);
          }
        }}
      >
        Apply beauty pass
      </button>
      <p className="hint">
        Skin smooth + mild eye/teeth lift. Use Liquify Warp/Bloat/Pucker for reshape.
      </p>
    </div>
  );
}

function ImageProps({ layer }: { layer: ImageLayer }) {
  const update = (patch: Partial<ImageLayer>) => {
    useEditorStore.getState().pushHistory();
    useEditorStore.getState().updateLayer(layer.id, patch);
  };

  return (
    <div className="props-block">
      <h4>Image</h4>
      <label>
        Opacity
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={layer.opacity}
          onChange={(e) =>
            useEditorStore.getState().updateLayer(layer.id, {
              opacity: Number(e.target.value),
            })
          }
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={layer.outline.enabled}
          onChange={(e) =>
            update({ outline: { ...layer.outline, enabled: e.target.checked } })
          }
        />
        Outline
      </label>
      <label>
        Outline width
        <input
          type="number"
          value={layer.outline.width}
          onChange={(e) =>
            update({
              outline: { ...layer.outline, width: Number(e.target.value) },
            })
          }
        />
      </label>
      <label>
        Outline color
        <input
          type="color"
          value={layer.outline.color}
          onChange={(e) =>
            update({ outline: { ...layer.outline, color: e.target.value } })
          }
        />
      </label>
      <label>
        Brightness
        <input
          type="range"
          min={-50}
          max={50}
          value={layer.grade.brightness}
          onChange={(e) =>
            update({
              grade: { ...layer.grade, brightness: Number(e.target.value) },
            })
          }
        />
      </label>
      <label>
        Contrast
        <input
          type="range"
          min={-50}
          max={50}
          value={layer.grade.contrast}
          onChange={(e) =>
            update({
              grade: { ...layer.grade, contrast: Number(e.target.value) },
            })
          }
        />
      </label>
      <label>
        Saturation
        <input
          type="range"
          min={-50}
          max={50}
          value={layer.grade.saturation}
          onChange={(e) =>
            update({
              grade: { ...layer.grade, saturation: Number(e.target.value) },
            })
          }
        />
      </label>
      <button
        type="button"
        onClick={async () => {
          const grade = { brightness: 8, contrast: 18, saturation: 12 };
          const store = useEditorStore.getState();
          store.pushHistory();
          store.setBusy('Applying grade…');
          try {
            const src = await bakeGrade(layer.src, grade);
            const img = await loadImage(src);
            store.replaceImageSrc(layer.id, src, {
              w: img.naturalWidth,
              h: img.naturalHeight,
            });
            store.updateLayer(layer.id, {
              grade: { brightness: 0, contrast: 0, saturation: 0 },
            });
          } finally {
            store.setBusy(null);
          }
        }}
      >
        Punchy grade
      </button>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            const store = useEditorStore.getState();
            const doc = store.doc!;
            update({
              transform: {
                ...layer.transform,
                scaleX: -layer.transform.scaleX,
              },
            });
            void doc;
          }}
        >
          Flip H
        </button>
        <button
          type="button"
          onClick={() => {
            const layouts = [
              { x: 40, y: 80 },
              { x: 800, y: 80 },
              { x: 40, y: 360 },
              { x: 980, y: 420 },
            ];
            const pick = layouts[Math.floor(Math.random() * layouts.length)];
            update({
              transform: { ...layer.transform, x: pick.x, y: pick.y },
            });
          }}
        >
          Layout helper
        </button>
      </div>
    </div>
  );
}

function TextProps({ layer }: { layer: TextLayer }) {
  const update = (patch: Partial<TextLayer>) => {
    useEditorStore.getState().pushHistory();
    useEditorStore.getState().updateLayer(layer.id, patch);
  };

  return (
    <div className="props-block">
      <h4>Text</h4>
      <label>
        Content
        <textarea
          rows={2}
          value={layer.text}
          onChange={(e) =>
            useEditorStore.getState().updateLayer(layer.id, { text: e.target.value })
          }
        />
      </label>

      <div className="effect-grid">
        {TEXT_EFFECT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.hint}
            className={layer.effect === p.id ? 'active' : ''}
            onClick={() => {
              useEditorStore.getState().pushHistory();
              useEditorStore.getState().updateLayer(layer.id, {
                ...applyTextPreset(p.id, layer),
                effect: p.id,
              });
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label>
        Size
        <input
          type="number"
          value={layer.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        />
      </label>
      <label>
        Fill
        <input
          type="color"
          value={layer.fill.startsWith('#') ? layer.fill : '#ffffff'}
          onChange={(e) => update({ fill: e.target.value })}
        />
      </label>
      <label>
        Stroke
        <input
          type="color"
          value={layer.stroke.startsWith('#') ? layer.stroke : '#000000'}
          onChange={(e) => update({ stroke: e.target.value })}
        />
      </label>
      <label>
        Stroke width
        <input
          type="number"
          value={layer.strokeWidth}
          onChange={(e) => update({ strokeWidth: Number(e.target.value) })}
        />
      </label>

      {(layer.effect === 'extrude-3d' || layer.effect === 'retro') && (
        <>
          <label>
            3D depth
            <input
              type="range"
              min={0}
              max={40}
              value={layer.extrudeDepth}
              onChange={(e) => update({ extrudeDepth: Number(e.target.value) })}
            />
          </label>
          <label>
            Extrude angle
            <input
              type="range"
              min={0}
              max={360}
              value={layer.extrudeAngle}
              onChange={(e) => update({ extrudeAngle: Number(e.target.value) })}
            />
          </label>
          <label>
            Extrude color
            <input
              type="color"
              value={layer.extrudeColor.startsWith('#') ? layer.extrudeColor : '#1a1208'}
              onChange={(e) => update({ extrudeColor: e.target.value })}
            />
          </label>
          <label>
            Skew
            <input
              type="range"
              min={-0.35}
              max={0.35}
              step={0.01}
              value={layer.skewX}
              onChange={(e) => update({ skewX: Number(e.target.value) })}
            />
          </label>
        </>
      )}

      {(layer.effect === 'gradient' ||
        layer.effect === 'extrude-3d' ||
        layer.effect === 'retro') && (
        <>
          <label>
            Gradient from
            <input
              type="color"
              value={layer.gradientFrom}
              onChange={(e) => update({ gradientFrom: e.target.value })}
            />
          </label>
          <label>
            Gradient to
            <input
              type="color"
              value={layer.gradientTo}
              onChange={(e) => update({ gradientTo: e.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
