import assert from 'node:assert/strict';
import test from 'node:test';
import { parseImagoDocumentEnvelope } from '../src/lib/documentImport.ts';

function layer() {
  return {
    id: 'layer-title',
    type: 'text',
    name: 'Title',
    role: 'text',
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal',
    text: 'HELLO',
    fontFamily: 'Anton',
    fontSize: 100,
    fontWeight: 400,
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 8,
    shadowColor: '#000000',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    align: 'center',
    transform: { x: 640, y: 360, scaleX: 1, scaleY: 1, rotation: 0 },
    effect: 'basic',
    extrudeDepth: 0,
    extrudeAngle: 0,
    extrudeColor: '#000000',
    gradientFrom: '#ffffff',
    gradientTo: '#000000',
    outerStroke: '#ffffff',
    outerStrokeWidth: 0,
    letterSpacing: 0,
    skewX: 0,
  };
}

function envelope() {
  const layers = [layer()];
  return {
    schemaVersion: 1,
    kind: 'imago-document',
    document: {
      id: 'handoff-test',
      name: 'Handoff test',
      width: 1280,
      height: 720,
      transparent: false,
      layers,
      selectedLayerId: 'layer-title',
      showSafeGuides: true,
      frames: [{ id: 'frame-01', layers: structuredClone(layers) }],
      activeFrameIndex: 0,
      fps: 8,
    },
  };
}

test('MCP handoff accepts a bounded editable document envelope', () => {
  const document = parseImagoDocumentEnvelope(envelope());
  assert.equal(document.id, 'handoff-test');
  assert.equal(document.layers[0].type, 'text');
});

test('MCP handoff rejects traversal IDs, duplicate layers, and non-embedded media', () => {
  const badId = envelope();
  badId.document.id = '../escape';
  assert.throws(() => parseImagoDocumentEnvelope(badId), /ID/);

  const duplicate = envelope();
  duplicate.document.layers.push(structuredClone(duplicate.document.layers[0]));
  assert.throws(() => parseImagoDocumentEnvelope(duplicate), /unique/);

  const external = envelope();
  external.document.layers = [{
    ...layer(),
    id: 'layer-image',
    type: 'image',
    role: 'support',
    src: 'file:///private/photo.png',
    naturalWidth: 10,
    naturalHeight: 10,
    outline: { enabled: false, width: 0, color: '#ffffff' },
    grade: { brightness: 0, contrast: 0, saturation: 0 },
    beauty: { amount: 0, smooth: 0, eyes: 0, teeth: 0, underEye: 0 },
  }];
  assert.throws(() => parseImagoDocumentEnvelope(external), /embedded image/);
});
