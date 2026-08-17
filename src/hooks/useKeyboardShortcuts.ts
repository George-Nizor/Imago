import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useBrandStore } from '../store/brandStore';
import { makeErrorNotice, reportDiagnostic } from '../lib/diagnostics';

export function useKeyboardShortcuts() {
  const doc = useEditorStore((s) => s.doc);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest('input, textarea, select, button, a, [contenteditable="true"]')
      ) {
        return;
      }

      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useEditorStore.getState().undo();
        return;
      }
      if (meta && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useEditorStore.getState().redo();
        return;
      }
      if (meta && e.key === 'd') {
        e.preventDefault();
        const id = useEditorStore.getState().doc?.selectedLayerId;
        if (id) useEditorStore.getState().duplicateLayer(id);
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        // export triggered from header primarily
        return;
      }

      if (!doc) return;

      switch (e.key.toLowerCase()) {
        case 'v':
          useEditorStore.getState().setTool('select');
          break;
        case 't':
          useEditorStore.getState().setTool('text');
          break;
        case 'l':
        case 'w':
          useEditorStore.getState().setTool('liquify-warp');
          break;
        case 'o':
          useEditorStore.getState().setTool('liquify-bloat');
          break;
        case 'p':
          useEditorStore.getState().setTool('liquify-pucker');
          break;
        case 'b':
          useEditorStore.getState().setTool('beauty');
          break;
        case 'e':
          useEditorStore.getState().setTool('erase');
          break;
        case 'delete':
        case 'backspace': {
          const id = useEditorStore.getState().doc?.selectedLayerId;
          if (id) useEditorStore.getState().deleteLayer(id);
          break;
        }
        case 'arrowleft':
          e.preventDefault();
          useEditorStore.getState().stepFrame(-1);
          break;
        case 'arrowright':
          e.preventDefault();
          useEditorStore.getState().stepFrame(1);
          break;
        case ' ':
          e.preventDefault();
          useEditorStore.getState().setPlaying(!useEditorStore.getState().playing);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc]);
}

export function DropImportOverlay() {
  const doc = useEditorStore((s) => s.doc);
  const brand = useBrandStore((s) => s.brand);

  useEffect(() => {
    if (!doc) return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) =>
        f.type.startsWith('image/'),
      );
      if (!files.length) return;
      const store = useEditorStore.getState();
      const usedSlotIds = new Set<string>();
      for (let i = 0; i < files.length; i++) {
        const currentDoc = useEditorStore.getState().doc;
        const selected =
          i === 0
            ? currentDoc?.layers.find((layer) => layer.id === currentDoc.selectedLayerId)
            : undefined;
        const selectedSlot =
          selected?.slot && selected.slot.kind !== 'title' && !usedSlotIds.has(selected.slot.id)
            ? selected
            : undefined;
        const emptySlot = currentDoc?.layers.find(
          (layer) =>
            layer.type === 'slot' &&
            layer.slot?.kind !== 'title' &&
            !usedSlotIds.has(layer.slot?.id ?? ''),
        );
        const targetSlot = selectedSlot ?? emptySlot;
        try {
          if (targetSlot?.slot) {
            usedSlotIds.add(targetSlot.slot.id);
            await store.replaceSlotFromFile(targetSlot.slot.id, files[i], brand);
            continue;
          }

          // Untemplated documents and files beyond the available slots remain free layers.
          const hasSubject = currentDoc?.layers.some(
            (layer) => layer.type === 'image' && layer.role === 'subject',
          );
          const role = !hasSubject && i === 0 ? 'subject' : 'support';
          await store.addImageFromFile(files[i], role, brand);
        } catch (cause) {
          reportDiagnostic('image-import', cause);
          store.setNotice(
            makeErrorNotice(
              'image-import',
              'A dropped image could not be added.',
              'Other compatible images will still be placed.',
            ),
          );
        }
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [doc, brand]);

  return null;
}
