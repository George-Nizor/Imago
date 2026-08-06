import { useRef } from 'react';
import { useEditorStore, getSelectedLayer } from '../store/editorStore';
import { useBrandStore } from '../store/brandStore';
import { usePrefsStore } from '../store/prefsStore';
import { exportDocument, exportAnimatedGif, exportFramePngs } from '../lib/export';
import { removeBackgroundFromSrc, ensureCutoutModel } from '../lib/cutout';
import { applyBeautyPass } from '../lib/beauty';
import { loadImage } from '../lib/imageUtils';

export function Header() {
  const doc = useEditorStore((s) => s.doc);
  const busy = useEditorStore((s) => s.busy);
  const brand = useBrandStore((s) => s.brand);
  const fileRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  if (!doc) return null;

  const runCutoutOutline = async () => {
    const store = useEditorStore.getState();
    const layer = getSelectedLayer(store.doc);
    if (!layer || layer.type !== 'image') {
      alert('Select an image layer first');
      return;
    }
    store.pushHistory();
    store.setBusy('Removing background…');
    try {
      await ensureCutoutModel();
      const src = await removeBackgroundFromSrc(layer.src);
      const img = await loadImage(src);
      store.replaceImageSrc(layer.id, src, { w: img.naturalWidth, h: img.naturalHeight });
      store.updateLayer(layer.id, {
        role: 'subject',
        name: 'Subject',
        outline: {
          enabled: true,
          width: brand.subjectOutlineWidth,
          color: brand.subjectOutlineColor,
        },
      });
    } catch (e) {
      console.error(e);
      alert('Background removal failed. Check the console.');
    } finally {
      store.setBusy(null);
    }
  };

  const runBeauty = async () => {
    const store = useEditorStore.getState();
    const prefs = usePrefsStore.getState();
    const layer = getSelectedLayer(store.doc);
    if (!layer || layer.type !== 'image') {
      alert('Select an image layer first');
      return;
    }
    store.pushHistory();
    store.setBusy('Beauty pass…');
    try {
      const amount = prefs.beautyDefault;
      const src = await applyBeautyPass(layer.src, { ...layer.beauty, amount });
      const img = await loadImage(src);
      store.replaceImageSrc(layer.id, src, { w: img.naturalWidth, h: img.naturalHeight });
      store.updateLayer(layer.id, { beauty: { ...layer.beauty, amount } });
    } catch (e) {
      console.error(e);
      alert('Beauty pass failed');
    } finally {
      store.setBusy(null);
    }
  };

  const onExport = async (format: 'png' | 'jpg') => {
    usePrefsStore.getState().set({ lastExportFormat: format });
    useEditorStore.getState().setBusy('Exporting…');
    try {
      await exportDocument(doc, format);
    } finally {
      useEditorStore.getState().setBusy(null);
    }
  };

  const onExportGif = async () => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().setBusy('Exporting GIF…');
    try {
      await exportAnimatedGif(doc);
    } catch (e) {
      console.error(e);
      alert('GIF export failed');
    } finally {
      useEditorStore.getState().setBusy(null);
    }
  };

  const onExportFrames = async () => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().setBusy('Exporting frames…');
    try {
      await exportFramePngs(doc);
    } catch (e) {
      console.error(e);
      alert('Frame export failed');
    } finally {
      useEditorStore.getState().setBusy(null);
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        <button type="button" className="ghost" onClick={() => useEditorStore.getState().closeDoc()}>
          ← Home
        </button>
        <input
          className="doc-name"
          value={doc.name}
          onChange={(e) => useEditorStore.getState().setDocName(e.target.value)}
        />
        {busy && <span className="busy">{busy}</span>}
      </div>

      <div className="header-actions">
        <button type="button" onClick={() => subjectRef.current?.click()}>
          Add subject
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Add support
        </button>
        <button type="button" className="accent" onClick={runCutoutOutline}>
          Cutout + outline
        </button>
        <button type="button" onClick={runBeauty}>
          Beauty pass
        </button>
        <button
          type="button"
          onClick={() => useEditorStore.getState().rerollBackground(brand)}
        >
          Reroll BG
        </button>
        <button
          type="button"
          onClick={() => useEditorStore.getState().applyBrandToDoc(brand)}
        >
          Apply brand
        </button>
        <button type="button" className="primary" onClick={() => onExport(doc.transparent ? 'png' : 'jpg')}>
          Export {doc.transparent ? 'PNG' : 'JPG'}
        </button>
        <button type="button" className="ghost" onClick={() => onExport('png')}>
          PNG
        </button>
        <button
          type="button"
          className="accent"
          title="Export all frames as animated GIF"
          onClick={onExportGif}
          disabled={doc.frames.length < 1}
        >
          GIF
        </button>
        <button
          type="button"
          className="ghost"
          title="Download each frame as PNG"
          onClick={onExportFrames}
          disabled={doc.frames.length < 2}
        >
          Frames
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        multiple
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          for (const f of files) {
            await useEditorStore.getState().addImageFromFile(f, 'support', brand);
          }
        }}
      />
      <input
        ref={subjectRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await useEditorStore.getState().addImageFromFile(file, 'subject', brand);
        }}
      />
    </header>
  );
}
