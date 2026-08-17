import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { renderFrameThumbnail } from '../lib/export';
import type { AnimFrame, DocumentState } from '../types/document';
import { Icon, IconButton } from './Icon';

export function Filmstrip() {
  const doc = useEditorStore((s) => s.doc);
  const playing = useEditorStore((s) => s.playing);
  const stripRef = useRef<HTMLDivElement>(null);
  const playbackFps = doc?.fps ?? 8;
  const frameCount = doc?.frames.length ?? 0;
  const activeFrameIndex = doc?.activeFrameIndex ?? 0;

  useEffect(() => {
    if (!playing || frameCount === 0) return;
    const ms = 1000 / Math.max(1, playbackFps);
    const id = window.setInterval(() => {
      useEditorStore.getState().stepFrame(1);
    }, ms);
    return () => window.clearInterval(id);
  }, [playing, playbackFps, frameCount]);

  useEffect(() => {
    if (!stripRef.current || frameCount === 0) return;
    const active = stripRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeFrameIndex, frameCount]);

  if (!doc) return null;

  const frames = doc.frames;
  const fps = doc.fps || 8;

  return (
    <div className="filmstrip">
      <div className="filmstrip-controls">
        <span className="filmstrip-label"><Icon name="film" /> Frames</span>
        <IconButton
          icon="previous"
          label="Previous frame (Left arrow)"
          className="ghost"
          onClick={() => useEditorStore.getState().stepFrame(-1)}
        />
        <IconButton
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pause animation' : 'Play animation'}
          className={playing ? 'accent' : 'ghost'}
          onClick={() => useEditorStore.getState().setPlaying(!playing)}
        />
        <IconButton
          icon="next"
          label="Next frame (Right arrow)"
          className="ghost"
          onClick={() => useEditorStore.getState().stepFrame(1)}
        />
        <label className="filmstrip-fps">
          FPS
          <input
            type="number"
            min={1}
            max={30}
            value={fps}
            onChange={(e) => useEditorStore.getState().setFps(Number(e.target.value) || 8)}
          />
        </label>
        <IconButton
          icon="plus"
          label="Duplicate current frame"
          onClick={() => useEditorStore.getState().duplicateFrame()}
        />
        <IconButton
          icon="trash"
          label="Delete current frame"
          className="ghost"
          disabled={frames.length <= 1}
          onClick={() => useEditorStore.getState().deleteFrame()}
        />
        <span className="filmstrip-meta">
          {doc.activeFrameIndex + 1}/{frames.length}
        </span>
      </div>

      <div className="filmstrip-track" ref={stripRef}>
        {frames.map((frame, i) => (
          <FrameThumb
            key={frame.id}
            doc={doc}
            frame={frame}
            index={i}
            active={i === doc.activeFrameIndex}
          />
        ))}
      </div>
    </div>
  );
}

function FrameThumb({
  doc,
  frame,
  index,
  active,
}: {
  doc: DocumentState;
  frame: AnimFrame;
  index: number;
  active: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const layers = index === doc.activeFrameIndex ? doc.layers : frame.layers;
  const layersKey = JSON.stringify(layers.map(layerThumbSig));

  useEffect(() => {
    let cancelled = false;
    renderFrameThumbnail(doc, layers, 140)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, layers, frame.id, index, layersKey]);

  return (
    <button
      type="button"
      className={`frame-thumb${active ? ' active' : ''}`}
      data-active={active ? 'true' : 'false'}
      onClick={() => useEditorStore.getState().selectFrame(index)}
      title={`Frame ${index + 1}`}
    >
      <span className="frame-thumb-index">{index + 1}</span>
      {src ? (
        <img src={src} alt={`Frame ${index + 1}`} draggable={false} />
      ) : (
        <span className="frame-thumb-placeholder" />
      )}
    </button>
  );
}

function layerThumbSig(l: AnimFrame['layers'][number]) {
  if (l.type === 'text') {
    return {
      id: l.id,
      t: l.text,
      x: l.transform.x,
      y: l.transform.y,
      s: l.fontSize,
      v: l.visible,
      o: l.opacity,
      e: l.effect,
      f: l.fill,
    };
  }
  if (l.type === 'image') {
    return {
      id: l.id,
      x: l.transform.x,
      y: l.transform.y,
      sx: l.transform.scaleX,
      sy: l.transform.scaleY,
      r: l.transform.rotation,
      v: l.visible,
      o: l.opacity,
      src: l.src.slice(0, 48),
    };
  }
  if (l.type === 'slot') {
    return { id: l.id, slot: l.slot?.id, v: l.visible };
  }
  return { id: l.id, v: l.visible, seed: l.seed, variant: l.variant };
}
