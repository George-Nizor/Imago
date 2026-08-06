import { useRef, useEffect, useState, useCallback } from 'react';
import {
  Stage,
  Layer as KonvaLayer,
  Image as KonvaImage,
  Rect,
  Transformer,
  Line,
  Group,
} from 'react-konva';
import type Konva from 'konva';
import { useEditorStore, getSelectedLayer } from '../store/editorStore';
import { loadImage } from '../lib/imageUtils';
import { liquifyStroke } from '../lib/liquify';
import { eraseOnImage } from '../lib/cutout';
import { rasterizeTextLayer } from '../lib/textEffects';
import type { ImageLayer, TextLayer, BackgroundLayer } from '../types/document';

function useHtmlImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadImage(src).then((img) => {
      if (!cancelled) setImage(img);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  return image;
}

function useOutlineImage(layer: ImageLayer) {
  const [out, setOut] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!layer.outline.enabled) {
      setOut(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const img = await loadImage(layer.src);
      const ow = Math.max(1, Math.round(layer.outline.width));
      const canvas = document.createElement('canvas');
      canvas.width = layer.naturalWidth + ow * 2;
      canvas.height = layer.naturalHeight + ow * 2;
      const ctx = canvas.getContext('2d')!;
      for (let a = 0; a < 360; a += 8) {
        const rad = (a * Math.PI) / 180;
        ctx.drawImage(img, ow + Math.cos(rad) * ow, ow + Math.sin(rad) * ow);
      }
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = layer.outline.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(img, ow, ow);
      const outImg = await loadImage(canvas.toDataURL('image/png'));
      if (!cancelled) setOut(outImg);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    layer.src,
    layer.outline.enabled,
    layer.outline.width,
    layer.outline.color,
    layer.naturalWidth,
    layer.naturalHeight,
  ]);
  return out;
}

function BgNode({
  layer,
  width,
  height,
}: {
  layer: BackgroundLayer;
  width: number;
  height: number;
}) {
  const image = useHtmlImage(layer.src);
  if (!image || !layer.visible) return null;
  return (
    <KonvaImage
      image={image}
      width={width}
      height={height}
      opacity={layer.opacity}
      listening={false}
    />
  );
}

function ImageNode({
  layer,
  selected,
  interactive,
  onSelect,
}: {
  layer: ImageLayer;
  selected: boolean;
  interactive: boolean;
  onSelect: () => void;
}) {
  const image = useHtmlImage(layer.src);
  const outlineImage = useOutlineImage(layer);
  const groupRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const w = layer.naturalWidth * Math.abs(layer.transform.scaleX);
  const h = layer.naturalHeight * Math.abs(layer.transform.scaleY);

  useEffect(() => {
    if (selected && interactive && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selected, interactive, image, outlineImage, layer]);

  if (!image || !layer.visible) return null;

  return (
    <>
      <Group
        ref={groupRef}
        x={layer.transform.x + w / 2}
        y={layer.transform.y + h / 2}
        rotation={layer.transform.rotation}
        scaleX={Math.sign(layer.transform.scaleX) || 1}
        scaleY={Math.sign(layer.transform.scaleY) || 1}
        opacity={layer.opacity}
        draggable={interactive && !layer.locked}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          const node = e.target;
          useEditorStore.getState().pushHistory();
          useEditorStore.getState().updateLayer(layer.id, {
            transform: {
              ...layer.transform,
              x: node.x() - w / 2,
              y: node.y() - h / 2,
            },
          });
        }}
        onTransformEnd={() => {
          const node = groupRef.current;
          if (!node) return;
          const sx = node.scaleX();
          const sy = node.scaleY();
          node.scaleX(Math.sign(sx) || 1);
          node.scaleY(Math.sign(sy) || 1);
          useEditorStore.getState().pushHistory();
          useEditorStore.getState().updateLayer(layer.id, {
            transform: {
              x: node.x() - (w * Math.abs(sx)) / 2,
              y: node.y() - (h * Math.abs(sy)) / 2,
              scaleX: layer.transform.scaleX * Math.abs(sx),
              scaleY: layer.transform.scaleY * Math.abs(sy),
              rotation: node.rotation(),
            },
          });
        }}
      >
        {outlineImage && layer.outline.enabled && (
          <KonvaImage
            image={outlineImage}
            offsetX={(w + layer.outline.width * 2) / 2}
            offsetY={(h + layer.outline.width * 2) / 2}
            width={w + layer.outline.width * 2}
            height={h + layer.outline.width * 2}
            listening={false}
          />
        )}
        <KonvaImage
          image={image}
          offsetX={w / 2}
          offsetY={h / 2}
          width={w}
          height={h}
          listening={false}
        />
      </Group>
      {selected && interactive && (
        <Transformer
          ref={trRef}
          rotateEnabled
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
          }
        />
      )}
    </>
  );
}

function TextNode({
  layer,
  selected,
  interactive,
  onSelect,
}: {
  layer: TextLayer;
  selected: boolean;
  interactive: boolean;
  onSelect: () => void;
}) {
  const groupRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [raster, setRaster] = useState<{
    image: HTMLImageElement;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { canvas, offsetX, offsetY } = rasterizeTextLayer(layer);
    const url = canvas.toDataURL('image/png');
    loadImage(url).then((image) => {
      if (!cancelled) setRaster({ image, offsetX, offsetY });
    });
    return () => {
      cancelled = true;
    };
  }, [layer]);

  useEffect(() => {
    if (selected && interactive && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selected, interactive, raster, layer]);

  if (!layer.visible || !raster) return null;

  return (
    <>
      <Group
        ref={groupRef}
        x={layer.transform.x}
        y={layer.transform.y}
        rotation={layer.transform.rotation}
        scaleX={layer.transform.scaleX}
        scaleY={layer.transform.scaleY}
        opacity={layer.opacity}
        draggable={interactive && !layer.locked}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={() => {
          const next = window.prompt('Edit text', layer.text);
          if (next != null) {
            useEditorStore.getState().pushHistory();
            useEditorStore.getState().updateLayer(layer.id, { text: next });
          }
        }}
        onDragEnd={(e) => {
          useEditorStore.getState().pushHistory();
          useEditorStore.getState().updateLayer(layer.id, {
            transform: {
              ...layer.transform,
              x: e.target.x(),
              y: e.target.y(),
            },
          });
        }}
        onTransformEnd={() => {
          const node = groupRef.current;
          if (!node) return;
          const sx = node.scaleX();
          const sy = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          useEditorStore.getState().pushHistory();
          useEditorStore.getState().updateLayer(layer.id, {
            fontSize: Math.max(8, layer.fontSize * Math.abs(sx)),
            transform: {
              ...layer.transform,
              x: node.x(),
              y: node.y(),
              rotation: node.rotation(),
              scaleX: Math.sign(sx) || 1,
              scaleY: Math.sign(sy) || 1,
            },
          });
        }}
      >
        <KonvaImage
          image={raster.image}
          offsetX={raster.offsetX}
          offsetY={raster.offsetY}
          width={raster.image.width}
          height={raster.image.height}
        />
      </Group>
      {selected && interactive && (
        <Transformer
          ref={trRef}
          rotateEnabled
          enabledAnchors={['middle-left', 'middle-right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']}
        />
      )}
    </>
  );
}

export function CanvasStage() {
  const doc = useEditorStore((s) => s.doc);
  const tool = useEditorStore((s) => s.tool);
  const stageScale = useEditorStore((s) => s.stageScale);
  const stagePos = useEditorStore((s) => s.stagePos);
  const brushSize = useEditorStore((s) => s.brushSize);
  const brushStrength = useEditorStore((s) => s.brushStrength);
  const eraseSoft = useEditorStore((s) => s.eraseSoft);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const strokePts = useRef<{ x: number; y: number }[]>([]);
  const painting = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const selected = getSelectedLayer(doc);
  const interactive = tool === 'select' || tool === 'transform' || tool === 'text';
  const paintingTool = tool.startsWith('liquify') || tool === 'erase';

  const toLayerCoords = useCallback((stageX: number, stageY: number, layer: ImageLayer) => {
    const t = layer.transform;
    return {
      x: (stageX - t.x) / t.scaleX,
      y: (stageY - t.y) / t.scaleY,
    };
  }, []);

  if (!doc) return null;

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const scaleBy = 1.05;
    const oldScale = stageScale;
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clamped = Math.min(3, Math.max(0.1, newScale));
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    useEditorStore.getState().setStageView(clamped, {
      x: pointer.x - mousePointTo.x * clamped,
      y: pointer.y - mousePointTo.y * clamped,
    });
  };

  const pointerToCanvas = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - stagePos.x) / stageScale,
      y: (pos.y - stagePos.y) / stageScale,
    };
  };

  const handlePaintStart = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!paintingTool || !selected || selected.type !== 'image') return;
    const canvas = pointerToCanvas(e);
    if (!canvas) return;
    painting.current = true;
    strokePts.current = [toLayerCoords(canvas.x, canvas.y, selected)];
  };

  const handlePaintMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!painting.current || !selected || selected.type !== 'image') return;
    const canvas = pointerToCanvas(e);
    if (!canvas) return;
    strokePts.current.push(toLayerCoords(canvas.x, canvas.y, selected));
  };

  const handlePaintEnd = async () => {
    if (!painting.current || !selected || selected.type !== 'image') return;
    painting.current = false;
    const pts = strokePts.current;
    strokePts.current = [];
    if (pts.length < 2) return;

    const store = useEditorStore.getState();
    store.pushHistory();
    store.setBusy(tool.startsWith('liquify') ? 'Liquify…' : 'Erasing…');
    try {
      if (tool.startsWith('liquify')) {
        const mode =
          tool === 'liquify-bloat' ? 'bloat' : tool === 'liquify-pucker' ? 'pucker' : 'warp';
        const radius = brushSize / Math.max(selected.transform.scaleX, 0.01);
        const url = await liquifyStroke(selected.src, mode, pts, radius, brushStrength, 0.5);
        store.replaceImageSrc(selected.id, url);
      } else if (tool === 'erase') {
        const radius = brushSize / Math.max(selected.transform.scaleX, 0.01);
        const strokes = pts.map((p) => ({
          x: p.x,
          y: p.y,
          r: radius,
          soft: eraseSoft,
        }));
        const url = await eraseOnImage(
          selected.src,
          strokes,
          selected.naturalWidth,
          selected.naturalHeight,
        );
        store.replaceImageSrc(selected.id, url);
      }
    } finally {
      store.setBusy(null);
    }
  };

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Stage
        width={size.w}
        height={size.h}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        onWheel={onWheel}
        onMouseDown={handlePaintStart}
        onMousemove={handlePaintMove}
        onMouseup={handlePaintEnd}
        onTouchStart={handlePaintStart}
        onTouchMove={handlePaintMove}
        onTouchEnd={handlePaintEnd}
        draggable={!paintingTool}
        onDragEnd={(e) => {
          if (e.target.getClassName() === 'Stage') {
            useEditorStore.getState().setStageView(stageScale, {
              x: e.target.x(),
              y: e.target.y(),
            });
          }
        }}
      >
        <KonvaLayer>
          <Rect
            width={doc.width}
            height={doc.height}
            fill={doc.transparent ? '#2a2a2e' : '#111'}
            listening={false}
          />

          {doc.layers.map((layer) => {
            if (layer.type === 'background') {
              return (
                <BgNode
                  key={layer.id}
                  layer={layer}
                  width={doc.width}
                  height={doc.height}
                />
              );
            }
            if (layer.type === 'image') {
              return (
                <ImageNode
                  key={layer.id}
                  layer={layer}
                  selected={doc.selectedLayerId === layer.id}
                  interactive={interactive}
                  onSelect={() => useEditorStore.getState().selectLayer(layer.id)}
                />
              );
            }
            return (
              <TextNode
                key={layer.id}
                layer={layer}
                selected={doc.selectedLayerId === layer.id}
                interactive={interactive}
                onSelect={() => useEditorStore.getState().selectLayer(layer.id)}
              />
            );
          })}

          {doc.showSafeGuides && (
            <Line
              points={[
                64,
                36,
                doc.width - 64,
                36,
                doc.width - 64,
                doc.height - 36,
                64,
                doc.height - 36,
                64,
                36,
              ]}
              stroke="rgba(255,200,50,0.35)"
              strokeWidth={2}
              dash={[8, 8]}
              listening={false}
            />
          )}
        </KonvaLayer>
      </Stage>
    </div>
  );
}
