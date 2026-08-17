import type { Tool } from '../types/document';
import { useEditorStore } from '../store/editorStore';
import { IconButton, type IconName } from './Icon';

const TOOLS: { id: Tool; icon: IconName; label: string; shortcut?: string }[] = [
  { id: 'select', icon: 'select', label: 'Select and move', shortcut: 'V' },
  { id: 'transform', icon: 'transform', label: 'Transform' },
  { id: 'text', icon: 'text', label: 'Text', shortcut: 'T' },
  { id: 'liquify-warp', icon: 'warp', label: 'Liquify warp', shortcut: 'W' },
  { id: 'liquify-bloat', icon: 'bloat', label: 'Liquify bloat', shortcut: 'O' },
  { id: 'liquify-pucker', icon: 'pucker', label: 'Liquify pucker', shortcut: 'P' },
  { id: 'beauty', icon: 'beauty', label: 'Beauty pass', shortcut: 'B' },
  { id: 'erase', icon: 'eraser', label: 'Erase', shortcut: 'E' },
];

export function Toolbar() {
  const tool = useEditorStore((state) => state.tool);
  const brushSize = useEditorStore((state) => state.brushSize);
  const brushStrength = useEditorStore((state) => state.brushStrength);
  const eraseSoft = useEditorStore((state) => state.eraseSoft);
  const showBrush = tool.startsWith('liquify') || tool === 'erase';

  return (
    <aside className="toolbar" aria-label="Editor tools">
      <div className="toolbar-mark" aria-hidden="true"><span /></div>
      {TOOLS.map((item, index) => (
        <div className={index === 3 ? 'tool-group-start' : ''} key={item.id}>
          <IconButton
            icon={item.icon}
            label={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
            pressed={tool === item.id}
            className={`tool${tool === item.id ? ' active' : ''}`}
            onClick={() => useEditorStore.getState().setTool(item.id)}
          />
        </div>
      ))}

      {showBrush && (
        <div className="brush-controls" aria-label="Brush settings">
          <label data-value={`${brushSize}px`}>
            <span>Size</span>
            <input
              aria-label="Brush size"
              type="range"
              min={10}
              max={200}
              value={brushSize}
              onChange={(event) =>
                useEditorStore.getState().setBrushSize(Number(event.target.value))
              }
            />
          </label>
          {tool.startsWith('liquify') && (
            <label data-value={`${Math.round(brushStrength * 100)}%`}>
              <span>Force</span>
              <input
                aria-label="Brush strength"
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={brushStrength}
                onChange={(event) =>
                  useEditorStore.getState().setBrushStrength(Number(event.target.value))
                }
              />
            </label>
          )}
          {tool === 'erase' && (
            <IconButton
              icon="sparkle"
              label={eraseSoft ? 'Soft edge on' : 'Soft edge off'}
              pressed={eraseSoft}
              onClick={() => useEditorStore.getState().setEraseSoft(!eraseSoft)}
            />
          )}
        </div>
      )}
    </aside>
  );
}
