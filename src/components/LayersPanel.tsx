import { useEditorStore } from '../store/editorStore';
import { useBrandStore } from '../store/brandStore';
import type { LayerRole } from '../types/document';

const ROLES: LayerRole[] = ['background', 'subject', 'support', 'text', 'none'];

export function LayersPanel() {
  const doc = useEditorStore((s) => s.doc);
  const brand = useBrandStore((s) => s.brand);

  if (!doc) return null;

  // Show top of stack first
  const ordered = [...doc.layers].reverse();

  return (
    <div className="panel layers-panel">
      <div className="panel-head">
        <h3>Layers</h3>
        <div className="row">
          <button
            type="button"
            title="Add text"
            onClick={() => useEditorStore.getState().addTextLayer(brand)}
          >
            +T
          </button>
          <button
            type="button"
            title="Duplicate"
            disabled={!doc.selectedLayerId}
            onClick={() =>
              doc.selectedLayerId &&
              useEditorStore.getState().duplicateLayer(doc.selectedLayerId)
            }
          >
            Dup
          </button>
          <button
            type="button"
            title="Delete"
            disabled={!doc.selectedLayerId}
            onClick={() =>
              doc.selectedLayerId &&
              useEditorStore.getState().deleteLayer(doc.selectedLayerId)
            }
          >
            Del
          </button>
        </div>
      </div>
      <ul className="layer-list">
        {ordered.map((layer) => {
          const realIndex = doc.layers.findIndex((l) => l.id === layer.id);
          return (
            <li
              key={layer.id}
              className={doc.selectedLayerId === layer.id ? 'selected' : ''}
              onClick={() => useEditorStore.getState().selectLayer(layer.id)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(realIndex));
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData('text/plain'));
                if (!Number.isNaN(from) && from !== realIndex) {
                  useEditorStore.getState().reorderLayer(from, realIndex);
                }
              }}
            >
              <button
                type="button"
                className="vis"
                title="Toggle visibility"
                onClick={(e) => {
                  e.stopPropagation();
                  useEditorStore.getState().toggleVisibility(layer.id);
                }}
              >
                {layer.visible ? '◉' : '〇'}
              </button>
              <div className="meta">
                <span className="name">{layer.name}</span>
                <span className="role">{layer.role}</span>
              </div>
              <select
                value={layer.role}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  useEditorStore
                    .getState()
                    .setLayerRole(layer.id, e.target.value as LayerRole)
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
