import type { Tool } from '../types/document';
import { useEditorStore } from '../store/editorStore';

const TOOLS: { id: Tool; label: string; tip: string }[] = [
  { id: 'select', label: 'SEL', tip: 'Select / move (V)' },
  { id: 'transform', label: 'XFR', tip: 'Transform' },
  { id: 'text', label: 'TYPE', tip: 'Text (T)' },
  { id: 'liquify-warp', label: 'WRP', tip: 'Liquify Warp' },
  { id: 'liquify-bloat', label: 'BLT', tip: 'Liquify Bloat' },
  { id: 'liquify-pucker', label: 'PKR', tip: 'Liquify Pucker' },
  { id: 'beauty', label: 'BTY', tip: 'Beauty' },
  { id: 'erase', label: 'ERS', tip: 'Erase (E)' },
];

export function Toolbar() {
  const tool = useEditorStore((s) => s.tool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const brushStrength = useEditorStore((s) => s.brushStrength);
  const eraseSoft = useEditorStore((s) => s.eraseSoft);

  const showBrush = tool.startsWith('liquify') || tool === 'erase';

  return (
    <aside className="toolbar">
      <span className="toolbar-label">Tools</span>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.tip}
          className={tool === t.id ? 'tool active' : 'tool'}
          onClick={() => useEditorStore.getState().setTool(t.id)}
        >
          {t.label}
        </button>
      ))}

      {showBrush && (
        <div className="brush-controls">
          <label>
            Size
            <input
              type="range"
              min={10}
              max={200}
              value={brushSize}
              onChange={(e) =>
                useEditorStore.getState().setBrushSize(Number(e.target.value))
              }
            />
          </label>
          {tool.startsWith('liquify') && (
            <label>
              Strength
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={brushStrength}
                onChange={(e) =>
                  useEditorStore.getState().setBrushStrength(Number(e.target.value))
                }
              />
            </label>
          )}
          {tool === 'erase' && (
            <label className="check">
              <input
                type="checkbox"
                checked={eraseSoft}
                onChange={(e) =>
                  useEditorStore.getState().setEraseSoft(e.target.checked)
                }
              />
              Soft
            </label>
          )}
        </div>
      )}
    </aside>
  );
}
