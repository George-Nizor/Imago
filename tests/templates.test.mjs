import assert from 'node:assert/strict';
import test from 'node:test';
import {
  THUMBNAIL_SIZES,
  THUMBNAIL_TEMPLATES,
  fitImageToBox,
  fitTitleFontSize,
  getThumbnailSize,
  getThumbnailTemplate,
  isNormalizedBox,
  scaleBox,
} from '../src/lib/templates.ts';
import {
  SUBJECT_LIBRARY_LIMIT,
  SUBJECT_LIBRARY_MAX_ITEM_BYTES,
  SUBJECT_LIBRARY_MAX_TOTAL_BYTES,
  isSubjectBlobSizeAllowed,
  selectRetainedSubjectRecords,
} from '../src/lib/subjectLibrary.ts';

test('ships six distinct thumbnail compositions', () => {
  assert.equal(THUMBNAIL_TEMPLATES.length, 6);
  assert.equal(new Set(THUMBNAIL_TEMPLATES.map((template) => template.id)).size, 6);
  assert.equal(new Set(THUMBNAIL_TEMPLATES.map((template) => template.name)).size, 6);
});

test('every template uses normalized geometry and unique slot ids', () => {
  for (const template of THUMBNAIL_TEMPLATES) {
    assert.equal(isNormalizedBox(template.title.box), true, `${template.id} title bounds`);
    assert.ok(template.title.x >= 0 && template.title.x <= 1, `${template.id} title x`);
    assert.ok(template.title.y >= 0 && template.title.y <= 1, `${template.id} title y`);

    const ids = [template.title.id, ...template.slots.map((slot) => slot.id)];
    assert.equal(new Set(ids).size, ids.length, `${template.id} slot ids must be unique`);
    assert.equal(template.slots.filter((slot) => slot.kind === 'background').length, 1);
    assert.equal(template.slots.filter((slot) => slot.kind === 'subject').length, 1);
    for (const slot of template.slots) {
      assert.equal(isNormalizedBox(slot.box), true, `${template.id}/${slot.id} bounds`);
    }
  }
});

test('publishes 4K, 1080p and 720p 16:9 sizes with 4K recommended', () => {
  assert.deepEqual(
    THUMBNAIL_SIZES.map(({ width, height }) => [width, height]),
    [
      [3840, 2160],
      [1920, 1080],
      [1280, 720],
    ],
  );
  assert.equal(THUMBNAIL_SIZES.filter((size) => size.recommended).length, 1);
  assert.equal(THUMBNAIL_SIZES.find((size) => size.recommended)?.id, 'youtube-4k');
  for (const size of THUMBNAIL_SIZES) assert.equal(size.width / size.height, 16 / 9);
});

test('unknown template and size ids fall back safely', () => {
  assert.equal(getThumbnailTemplate('missing').id, THUMBNAIL_TEMPLATES[0].id);
  assert.equal(getThumbnailSize('missing').id, 'youtube-1080');
});

test('normalized boxes scale proportionally at every canvas size', () => {
  const box = { x: 0.1, y: 0.2, width: 0.4, height: 0.5 };
  assert.deepEqual(scaleBox(box, 1280, 720), { x: 128, y: 144, width: 512, height: 360 });
  assert.deepEqual(scaleBox(box, 3840, 2160), { x: 384, y: 432, width: 1536, height: 1080 });
});

test('contain centers the full image and cover fills the slot', () => {
  const box = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  assert.deepEqual(fitImageToBox(200, 100, 1000, 1000, box, 'contain'), {
    x: 250,
    y: 375,
    scaleX: 2.5,
    scaleY: 2.5,
    rotation: 0,
  });
  assert.deepEqual(fitImageToBox(200, 100, 1000, 1000, box, 'cover'), {
    x: 0,
    y: 250,
    scaleX: 5,
    scaleY: 5,
    rotation: 0,
  });
});

test('slot fitting remains proportional between 1080p and 4K canvases', () => {
  const box = { x: 0.52, y: 0.1, width: 0.43, height: 0.8 };
  const hd = fitImageToBox(600, 900, 1920, 1080, box, 'contain');
  const fourK = fitImageToBox(600, 900, 3840, 2160, box, 'contain');
  assert.deepEqual(fourK, {
    x: hd.x * 2,
    y: hd.y * 2,
    scaleX: hd.scaleX * 2,
    scaleY: hd.scaleY * 2,
    rotation: 0,
  });
});

test('long titles shrink to their slot while short titles keep the requested size', () => {
  assert.equal(fitTitleFontSize(120, 600, 480), 120);
  assert.equal(fitTitleFontSize(120, 600, 1200), 60);
  const requested = 120;
  const available = 100;
  const measured = 1000;
  const effective = fitTitleFontSize(requested, available, measured);
  assert.equal(effective, 12);
  assert.ok((effective / requested) * measured <= available);
});

test('reusable subjects deduplicate by content id and keep the most recent version', () => {
  const retained = selectRetainedSubjectRecords([
    { id: 'same', byteSize: 20, createdAt: 1, lastUsedAt: 4, marker: 'old' },
    { id: 'same', byteSize: 20, createdAt: 2, lastUsedAt: 7, marker: 'new' },
    { id: 'other', byteSize: 20, createdAt: 3, lastUsedAt: 5, marker: 'other' },
  ]);
  assert.deepEqual(retained.map(({ id, marker }) => [id, marker]), [
    ['same', 'new'],
    ['other', 'other'],
  ]);
});

test('reusable subject retention respects both item and total-byte caps', () => {
  const records = Array.from({ length: SUBJECT_LIBRARY_LIMIT + 3 }, (_, index) => ({
    id: `subject-${index}`,
    byteSize: 10,
    createdAt: index,
    lastUsedAt: index,
  }));
  assert.equal(selectRetainedSubjectRecords(records, 3, 100).length, 3);
  assert.deepEqual(
    selectRetainedSubjectRecords(records, 10, 25).map(({ id }) => id),
    [`subject-${records.length - 1}`, `subject-${records.length - 2}`],
  );
  assert.ok(SUBJECT_LIBRARY_MAX_TOTAL_BYTES > SUBJECT_LIBRARY_MAX_ITEM_BYTES);
});

test('reusable subject storage rejects empty and oversized blobs', () => {
  assert.equal(isSubjectBlobSizeAllowed(0), false);
  assert.equal(isSubjectBlobSizeAllowed(SUBJECT_LIBRARY_MAX_ITEM_BYTES), true);
  assert.equal(isSubjectBlobSizeAllowed(SUBJECT_LIBRARY_MAX_ITEM_BYTES + 1), false);
});
