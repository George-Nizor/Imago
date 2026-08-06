import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useBrandStore } from '../store/brandStore';

export function useKeyboardShortcuts() {
  const doc = useEditorStore((s) => s.doc);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

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
      // First image as subject if none exists
      const hasSubject = store.doc?.layers.some((l) => l.role === 'subject');
      for (let i = 0; i < files.length; i++) {
        const role = !hasSubject && i === 0 ? 'subject' : 'support';
        await store.addImageFromFile(files[i], role, brand);
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
