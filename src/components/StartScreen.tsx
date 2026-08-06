import { useBrandStore } from '../store/brandStore';
import { useEditorStore } from '../store/editorStore';

export function StartScreen() {
  const brand = useBrandStore((s) => s.brand);

  return (
    <div className="start-screen">
      <div className="start-grain" aria-hidden />
      <div className="start-rail">
        <span className="rail-mark">FK</span>
        <span className="rail-meta">LOCAL · PERSONAL</span>
      </div>

      <div className="start-inner">
        <p className="brand-mark">Framekit</p>
        <h1>
          Cut. Outline.
          <br />
          Punch the title.
        </h1>
        <p className="lede">
          A broadcast-grade compositor for YouTube faces and game title cards — built around
          the moves you actually make.
        </p>

        <div className="start-actions">
          <button
            type="button"
            className="start-action primary-action"
            onClick={() => useEditorStore.getState().newThumbnail(brand)}
          >
            <span className="action-index">01</span>
            <span className="action-body">
              <strong>Thumbnail Composer</strong>
              <span>1280×720 · cutout · 3D type · export</span>
            </span>
            <span className="action-arrow" aria-hidden>
              →
            </span>
          </button>
          <button
            type="button"
            className="start-action"
            onClick={() => useEditorStore.getState().newTitleCard(brand)}
          >
            <span className="action-index">02</span>
            <span className="action-body">
              <strong>Title Card</strong>
              <span>1920×1080 · transparent PNG</span>
            </span>
            <span className="action-arrow" aria-hidden>
              →
            </span>
          </button>
        </div>

        <div className="start-brand">
          <span className="brand-label">Brand plate</span>
          <span className="swatch" style={{ background: brand.primary }} />
          <span className="swatch" style={{ background: brand.accent }} />
          <span
            className="swatch"
            style={{ background: brand.textFill, outline: '1px solid #5a5246' }}
          />
        </div>
      </div>

      <aside className="start-aside" aria-hidden>
        <div className="aside-block">
          <span>FX</span>
          <em>3D · Neon · Chrome</em>
        </div>
        <div className="aside-block">
          <span>STACK</span>
          <em>BG · Support · Subject · Type</em>
        </div>
      </aside>
    </div>
  );
}
