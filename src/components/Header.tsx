import { useRef, useState } from 'react';
import { useEditorStore, getSelectedLayer } from '../store/editorStore';
import { useBrandStore } from '../store/brandStore';
import { usePrefsStore } from '../store/prefsStore';
import { exportDocument, exportAnimatedGif, exportFramePngs } from '../lib/export';
import { removeBackgroundFromSrc, ensureCutoutModel } from '../lib/cutout';
import { applyBeautyPass } from '../lib/beauty';
import { loadImage } from '../lib/imageUtils';
import {
  DEFAULT_EXPORT_SIZE_ID,
  THUMBNAIL_SIZES,
  getThumbnailSize,
  type ThumbnailSizeId,
} from '../lib/templates';
import { IconButton } from './Icon';
import { ReplaceSelectedSlotButton } from './TemplateSlotsPanel';
import {
  makeErrorNotice,
  makeNotice,
  reportDiagnostic,
  type DiagnosticContext,
} from '../lib/diagnostics';
import { saveSubjectCutout } from '../lib/subjectLibrary';

export function Header() {
  const doc = useEditorStore((s) => s.doc);
  const busy = useEditorStore((s) => s.busy);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const brand = useBrandStore((s) => s.brand);
  const fileRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [exportSizeId, setExportSizeId] = useState<ThumbnailSizeId>(DEFAULT_EXPORT_SIZE_ID);

  if (!doc) return null;
  const selectedLayer = getSelectedLayer(doc);
  const hasSelectedImage = selectedLayer?.type === 'image';
  const warmCutout = () => void ensureCutoutModel().catch(() => undefined);
  const showFailure = (
    context: DiagnosticContext,
    cause: unknown,
    message: string,
    detail?: string,
  ) => {
    reportDiagnostic(context, cause);
    useEditorStore.getState().setNotice(makeErrorNotice(context, message, detail));
  };

  const runCutoutOutline = async () => {
    const store = useEditorStore.getState();
    const layer = getSelectedLayer(store.doc);
    if (!layer || layer.type !== 'image') return;
    store.setBusy('Removing background…');
    try {
      const src = await removeBackgroundFromSrc(layer.src, (percent) => {
        store.setBusy(`Preparing cutout AI · ${percent}%`);
      });
      const img = await loadImage(src);
      const active = store.doc?.layers.find((candidate) => candidate.id === layer.id);
      if (active?.type !== 'image' || active.id !== layer.id || active.src !== layer.src) {
        URL.revokeObjectURL(src);
        return;
      }
      store.pushHistory();
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
      try {
        await saveSubjectCutout({
          blob: await (await fetch(src)).blob(),
          name: layer.name,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
      } catch (cause) {
        reportDiagnostic('storage', cause);
      }
      store.setNotice(makeNotice('success', 'Background removed.', 'The cutout is ready to reuse.'));
    } catch (cause) {
      showFailure('cutout', cause, 'Background removal failed.', 'The original image was left unchanged.');
    } finally {
      store.setBusy(null);
    }
  };

  const runBeauty = async () => {
    const store = useEditorStore.getState();
    const prefs = usePrefsStore.getState();
    const layer = getSelectedLayer(store.doc);
    if (!layer || layer.type !== 'image') return;
    store.setBusy('Beauty pass…');
    try {
      const amount = prefs.beautyDefault;
      const src = await applyBeautyPass(layer.src, { ...layer.beauty, amount });
      const img = await loadImage(src);
      const active = store.doc?.layers.find((candidate) => candidate.id === layer.id);
      if (active?.type !== 'image' || active.id !== layer.id || active.src !== layer.src) {
        URL.revokeObjectURL(src);
        return;
      }
      store.pushHistory();
      store.replaceImageSrc(layer.id, src, { w: img.naturalWidth, h: img.naturalHeight });
      store.updateLayer(layer.id, { beauty: { ...layer.beauty, amount } });
      store.setNotice(makeNotice('success', 'Beauty pass applied.'));
    } catch (cause) {
      showFailure('beauty', cause, 'Beauty pass failed.');
    } finally {
      store.setBusy(null);
    }
  };

  const onExport = async (format: 'png' | 'jpg') => {
    usePrefsStore.getState().set({ lastExportFormat: format });
    useEditorStore.getState().setBusy('Exporting…');
    try {
      const size = doc.templateId ? getThumbnailSize(exportSizeId) : null;
      await exportDocument(
        doc,
        format,
        size
          ? {
              width: size.width,
              height: size.height,
              label: size.shortLabel.toLowerCase(),
            }
          : undefined,
      );
      useEditorStore.getState().setNotice(makeNotice('success', `${format.toUpperCase()} export ready.`));
    } catch (cause) {
      showFailure('export-image', cause, 'Image export failed.', 'Try a smaller export size or another format.');
    } finally {
      useEditorStore.getState().setBusy(null);
    }
  };

  const onExportGif = async () => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().setBusy('Exporting GIF…');
    try {
      await exportAnimatedGif(doc);
      useEditorStore.getState().setNotice(makeNotice('success', 'Animated GIF export ready.'));
    } catch (cause) {
      showFailure('export-gif', cause, 'GIF export failed.', 'Your frames remain unchanged.');
    } finally {
      useEditorStore.getState().setBusy(null);
    }
  };

  const onExportFrames = async () => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().setBusy('Exporting frames…');
    try {
      await exportFramePngs(doc);
      useEditorStore.getState().setNotice(makeNotice('success', 'Frame PNG exports ready.'));
    } catch (cause) {
      showFailure('export-frames', cause, 'Frame export failed.', 'Your frames remain unchanged.');
    } finally {
      useEditorStore.getState().setBusy(null);
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        <div className="product-lockup" aria-label="Imago by Instrumenta">
          <img src="./imago-mark.svg" alt="" />
          <span>IMAGO</span>
        </div>
        <IconButton
          icon="arrow-left"
          label="Back to templates"
          className="ghost"
          onClick={() => useEditorStore.getState().closeDoc()}
        />
        <input
          className="doc-name"
          aria-label="Document name"
          value={doc.name}
          onChange={(e) => useEditorStore.getState().setDocName(e.target.value)}
        />
        {busy && <span className="busy" role="status" aria-live="polite">{busy}</span>}
      </div>

      <div className="header-actions">
        <div className="action-group" aria-label="History">
          <IconButton
            icon="undo"
            label="Undo"
            disabled={!canUndo}
            onClick={() => useEditorStore.getState().undo()}
          />
          <IconButton
            icon="redo"
            label="Redo"
            disabled={!canRedo}
            onClick={() => useEditorStore.getState().redo()}
          />
        </div>
        <div className="action-group" aria-label="Add content">
          <IconButton
            icon="user"
            label="Add subject"
            onPointerDown={warmCutout}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') warmCutout();
            }}
            onClick={() => {
              warmCutout();
              subjectRef.current?.click();
            }}
          />
          <IconButton icon="image" label="Add supporting images" onClick={() => fileRef.current?.click()} />
          <ReplaceSelectedSlotButton />
        </div>
        <div className="action-group" aria-label="Quick actions">
          <IconButton
            icon="scissors"
            label="Remove background and add outline"
            className="accent"
            disabled={!hasSelectedImage}
            onPointerDown={warmCutout}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') warmCutout();
            }}
            onClick={runCutoutOutline}
          />
          <IconButton icon="beauty" label="Apply beauty pass" disabled={!hasSelectedImage} onClick={runBeauty} />
          <IconButton icon="shuffle" label="Reroll generated background" onClick={() => useEditorStore.getState().rerollBackground(brand)} />
          <IconButton icon="palette" label="Apply brand kit" onClick={() => useEditorStore.getState().applyBrandToDoc(brand)} />
        </div>
        <div className="export-group" aria-label="Export">
          {doc.templateId && (
            <select
              className="export-size"
              value={exportSizeId}
              aria-label="Export resolution"
              onChange={(event) => setExportSizeId(event.target.value as ThumbnailSizeId)}
            >
              {THUMBNAIL_SIZES.map((size) => (
                <option key={size.id} value={size.id}>
                  {size.shortLabel}{size.recommended ? ' ★' : ''} · {size.width}×{size.height}
                </option>
              ))}
            </select>
          )}
          <IconButton
            icon="download"
            label={`Export ${doc.transparent ? 'PNG' : 'JPG'}${doc.templateId ? ` at ${getThumbnailSize(exportSizeId).label}` : ''}`}
            className="primary"
            onClick={() => onExport(doc.transparent ? 'png' : 'jpg')}
          />
          {!doc.transparent && (
            <IconButton icon="image" label="Export PNG copy" onClick={() => onExport('png')} />
          )}
          {doc.frames.length > 1 && (
            <>
              <IconButton icon="film" label="Export animated GIF" className="accent" onClick={onExportGif} />
              <IconButton icon="frames" label="Export every frame as PNG" onClick={onExportFrames} />
            </>
          )}
        </div>
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
          for (let index = 0; index < files.length; index++) {
            const store = useEditorStore.getState();
            const current = store.doc;
            const selected =
              index === 0
                ? current?.layers.find(
                    (layer) =>
                      layer.id === current.selectedLayerId && layer.slot?.kind === 'support',
                  )
                : undefined;
            const target =
              selected ??
              current?.layers.find(
                (layer) => layer.type === 'slot' && layer.slot?.kind === 'support',
              );
            try {
              if (target?.slot) {
                await store.replaceSlotFromFile(target.slot.id, files[index], brand);
              } else {
                await store.addImageFromFile(files[index], 'support', brand);
              }
            } catch (cause) {
              showFailure('image-import', cause, 'Supporting image could not be added.');
            }
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
          if (!file) return;
          const store = useEditorStore.getState();
          const subjectSlot = store.doc?.layers.find((layer) => layer.slot?.kind === 'subject');
          try {
            if (subjectSlot?.slot) {
              await store.replaceSlotFromFile(subjectSlot.slot.id, file, brand);
            } else {
              await store.addImageFromFile(file, 'subject', brand);
            }
          } catch (cause) {
            showFailure('image-import', cause, 'Subject image could not be added.');
          }
        }}
      />
    </header>
  );
}
