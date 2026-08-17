import { useEffect, useMemo, useRef, useState } from 'react';
import { useBrandStore } from '../store/brandStore';
import { useEditorStore } from '../store/editorStore';
import { SLOT_REPLACE_EVENT, requestSlotReplacement } from '../lib/slotEvents';
import {
  deleteSubjectCutout,
  listSubjectCutouts,
  SUBJECT_LIBRARY_CHANGED_EVENT,
  type StoredSubjectCutout,
} from '../lib/subjectLibrary';
import type { Layer } from '../types/document';
import { Icon, IconButton, type IconName } from './Icon';
import { ensureCutoutModel } from '../lib/cutout';
import { reportDiagnostic } from '../lib/diagnostics';

function iconForLayer(layer: Layer): IconName {
  if (layer.slot?.kind === 'subject') return 'user';
  if (layer.slot?.kind === 'background') return 'background';
  if (layer.slot?.kind === 'title') return 'text';
  return 'image';
}

export function TemplateSlotsPanel() {
  const doc = useEditorStore((state) => state.doc);
  const busy = useEditorStore((state) => state.busy);
  const brand = useBrandStore((state) => state.brand);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<StoredSubjectCutout[]>([]);
  const [libraryAvailable, setLibraryAvailable] = useState(true);
  const slottedLayers = useMemo(
    () => doc?.layers.filter((layer) => layer.slot) ?? [],
    [doc?.layers],
  );

  useEffect(() => {
    const onReplace = (event: Event) => {
      const slotId = (event as CustomEvent<{ slotId?: string }>).detail?.slotId;
      if (!slotId) return;
      const target = useEditorStore
        .getState()
        .doc?.layers.find((layer) => layer.slot?.id === slotId);
      if (target?.slot?.cutout) void ensureCutoutModel().catch(() => undefined);
      pendingSlot.current = slotId;
      inputRef.current?.click();
    };
    window.addEventListener(SLOT_REPLACE_EVENT, onReplace);
    return () => window.removeEventListener(SLOT_REPLACE_EVENT, onReplace);
  }, []);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const records = await listSubjectCutouts();
        if (!disposed) {
          setSubjects(records);
          setLibraryAvailable(true);
        }
      } catch (cause) {
        reportDiagnostic('storage', cause);
        if (!disposed) setLibraryAvailable(false);
      }
    };
    void refresh();
    window.addEventListener(SUBJECT_LIBRARY_CHANGED_EVENT, refresh);
    return () => {
      disposed = true;
      window.removeEventListener(SUBJECT_LIBRARY_CHANGED_EVENT, refresh);
    };
  }, []);

  if (!doc?.templateId || slottedLayers.length === 0) return null;

  const imageSlots = slottedLayers.filter((layer) => layer.slot?.kind !== 'title');
  const completed = imageSlots.filter((layer) => layer.type !== 'slot').length;
  const subjectLayer = slottedLayers.find((layer) => layer.slot?.kind === 'subject');
  const emptyImageSlots = imageSlots.filter((layer) => layer.type === 'slot');
  const nextSlot =
    emptyImageSlots.find((layer) => layer.slot?.kind === 'subject') ?? emptyImageSlots[0];

  return (
    <section className="panel template-slots-panel" aria-labelledby="template-slots-title">
      <div className="panel-head template-panel-head">
        <div>
          <span className="eyebrow">Composition</span>
          <h3 id="template-slots-title">{doc.templateName ?? 'Template slots'}</h3>
        </div>
        <span className="slot-progress" aria-label={`${completed} of ${imageSlots.length} image slots filled`}>
          {completed}/{imageSlots.length}
        </span>
      </div>

      <div className={`composition-readiness${nextSlot ? '' : ' ready'}`} role="status">
        <Icon name={nextSlot ? 'next' : 'check'} />
        <span>
          <strong>{nextSlot ? `Next: add ${nextSlot.slot?.label.toLowerCase()}` : 'Ready to export'}</strong>
          <small>
            {nextSlot
              ? 'Fill each visual slot, then edit the headline.'
              : 'All visual slots are filled. Review the headline at canvas size.'}
          </small>
        </span>
      </div>

      {(subjects.length > 0 || !libraryAvailable) && subjectLayer?.slot && (
        <section className="subject-shelf" aria-labelledby="subject-shelf-title">
          <div className="subject-shelf-head">
            <div>
              <span className="eyebrow">Reuse</span>
              <h4 id="subject-shelf-title">Recent cutouts</h4>
            </div>
            <span>{subjects.length}</span>
          </div>
          {libraryAvailable ? (
            <ul className="subject-shelf-grid">
              {subjects.map((subject) => (
                <SubjectShelfItem
                  key={subject.id}
                  subject={subject}
                  onUse={async () => {
                    setError(null);
                    try {
                      await useEditorStore
                        .getState()
                        .replaceSubjectSlotFromLibrary(subjectLayer.slot!.id, subject, brand);
                    } catch (cause) {
                      reportDiagnostic('storage', cause);
                      setError('That saved cutout could not be placed.');
                    }
                  }}
                  onDelete={async () => {
                    setError(null);
                    try {
                      await deleteSubjectCutout(subject.id);
                    } catch (cause) {
                      reportDiagnostic('storage', cause);
                      setError('That saved cutout could not be deleted.');
                    }
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="subject-shelf-unavailable">Browser storage is unavailable in this session.</p>
          )}
        </section>
      )}

      <div className="slot-list">
        {slottedLayers.map((layer) => {
          const slot = layer.slot!;
          if (slot.kind === 'title' && layer.type === 'text') {
            return (
              <label className="slot-title-control" key={layer.id}>
                <span><Icon name="text" /> {slot.label}</span>
                <input
                  value={layer.text}
                  maxLength={54}
                  onFocus={() => useEditorStore.getState().selectLayer(layer.id)}
                  onChange={(event) =>
                    useEditorStore.getState().updateLayer(layer.id, { text: event.target.value })
                  }
                />
                <small className={layer.text.trim().split(/\s+/).length > 5 ? 'warning' : ''}>
                  {layer.text.trim().split(/\s+/).filter(Boolean).length} words · 4–5 reads best
                </small>
              </label>
            );
          }

          const hasPreview = layer.type === 'image' || layer.type === 'background';
          const selected = doc.selectedLayerId === layer.id;
          return (
            <button
              key={layer.id}
              type="button"
              className={`slot-control${hasPreview ? ' filled' : ''}${selected ? ' selected' : ''}`}
              onClick={() => {
                useEditorStore.getState().selectLayer(layer.id);
                requestSlotReplacement(slot.id);
              }}
              aria-label={`${hasPreview ? 'Replace' : 'Add'} ${slot.label}`}
            >
              <span className="slot-preview">
                {hasPreview ? (
                  <img src={layer.src} alt="" />
                ) : (
                  <Icon name={iconForLayer(layer)} />
                )}
              </span>
              <span className="slot-copy">
                <strong>{slot.label}</strong>
                <small>
                  {layer.type === 'slot'
                    ? slot.cutout
                      ? 'Add image · cutout automatic'
                      : 'Add image'
                    : 'Click to replace'}
                </small>
              </span>
              <Icon name={hasPreview ? 'replace' : 'plus'} className="slot-action-icon" />
            </button>
          );
        })}
      </div>

      {busy && <p className="slot-status" role="status" aria-live="polite"><span className="status-pulse" />{busy}</p>}
      {error && <p className="slot-error" role="alert">{error}</p>}
      <p className="slot-hint">Click a slot here, or double-click it on the canvas.</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const slotId = pendingSlot.current;
          pendingSlot.current = null;
          if (!file || !slotId) return;
          setError(null);
          try {
            await useEditorStore.getState().replaceSlotFromFile(slotId, file, brand);
          } catch (cause) {
            reportDiagnostic('image-import', cause);
            setError('That image could not be placed. Try another file.');
          }
        }}
      />
    </section>
  );
}

function SubjectShelfItem({
  subject,
  onUse,
  onDelete,
}: {
  subject: StoredSubjectCutout;
  onUse: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const previewUrl = useMemo(() => URL.createObjectURL(subject.blob), [subject.blob]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  return (
    <li>
      <button
        type="button"
        className="subject-shelf-use"
        aria-label={`Use saved cutout ${subject.name}`}
        data-tooltip={`Use ${subject.name}`}
        onClick={() => void onUse()}
      >
        <img src={previewUrl} alt="" />
      </button>
      <button
        type="button"
        className="subject-shelf-delete"
        aria-label={`Delete saved cutout ${subject.name}`}
        data-tooltip={`Delete ${subject.name}`}
        onClick={() => void onDelete()}
      >
        <Icon name="trash" />
      </button>
    </li>
  );
}

export function ReplaceSelectedSlotButton() {
  const doc = useEditorStore((state) => state.doc);
  const layer = doc?.layers.find((candidate) => candidate.id === doc.selectedLayerId);
  if (!layer?.slot || layer.slot.kind === 'title') return null;
  return (
    <IconButton
      icon="replace"
      label={`Replace ${layer.slot.label}`}
      onClick={() => requestSlotReplacement(layer.slot!.id)}
    />
  );
}
