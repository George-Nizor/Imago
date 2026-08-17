import { useEditorStore } from '../store/editorStore';
import { useBrandStore } from '../store/brandStore';
import type { LayerRole } from '../types/document';
import { Icon, IconButton, type IconName } from './Icon';

const ROLES: LayerRole[] = ['background', 'subject', 'support', 'text', 'none'];

export function LayersPanel() {
  const doc = useEditorStore((s) => s.doc);
  const brand = useBrandStore((s) => s.brand);

  if (!doc) return null;

  // Show top of stack first
  const ordered = [...doc.layers].reverse();
  const selected = doc.layers.find((layer) => layer.id === doc.selectedLayerId);

  const layerIcon = (type: (typeof doc.layers)[number]['type'], role: LayerRole): IconName => {
    if (type === 'text') return 'text';
    if (type === 'background' || role === 'background') return 'background';
    if (role === 'subject') return 'user';
    if (type === 'slot') return 'plus';
    return 'image';
  };

  return (
    <div className="panel layers-panel">
      <div className="panel-head">
        <h3><Icon name="layers" /> Layers</h3>
        <div className="row">
          <IconButton
            icon="text"
            label="Add text layer"
            onClick={() => useEditorStore.getState().addTextLayer(brand)}
          />
          <IconButton
            icon="copy"
            label="Duplicate selected layer"
            disabled={!doc.selectedLayerId || Boolean(selected?.slot)}
            onClick={() =>
              doc.selectedLayerId &&
              useEditorStore.getState().duplicateLayer(doc.selectedLayerId)
            }
          />
          <IconButton
            icon="trash"
            label={selected?.slot ? 'Template slots stay in the composition' : 'Delete selected layer'}
            disabled={!doc.selectedLayerId || Boolean(selected?.slot)}
            onClick={() =>
              doc.selectedLayerId &&
              useEditorStore.getState().deleteLayer(doc.selectedLayerId)
            }
          />
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
              draggable={!layer.slot}
              onDragStart={(e) => {
                if (!layer.slot) e.dataTransfer.setData('text/plain', String(realIndex));
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
              <IconButton
                icon={layer.visible ? 'eye' : 'eye-off'}
                label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                className="vis"
                onClick={(e) => {
                  e.stopPropagation();
                  useEditorStore.getState().toggleVisibility(layer.id);
                }}
              />
              <span className="layer-kind" aria-hidden="true">
                <Icon name={layerIcon(layer.type, layer.role)} />
              </span>
              <div className="meta">
                <span className="name">{layer.name}</span>
                <span className="role">{layer.type === 'slot' ? 'empty slot' : layer.role}</span>
              </div>
              {layer.slot ? (
                <span className="slot-lock" title="Position supplied by the template">Slot</span>
              ) : (
                <select
                  aria-label={`Role for ${layer.name}`}
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
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
