import assert from "node:assert/strict";
import { test } from "node:test";
import { imageInfo } from "../server/image-info.mjs";
import { makePng } from "./helpers.mjs";

test("PNG header", () => assert.deepEqual(imageInfo(makePng(30, 20)), { type: "png", width: 30, height: 20 }));

test("JPEG frame header", () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03]), Buffer.alloc(9),
  ]);
  assert.deepEqual(imageInfo(jpeg), { type: "jpeg", width: 600, height: 300 });
});

test("WebP lossy, lossless and extended", () => {
  const riff = (kind, body) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from(kind), Buffer.alloc(4), body]);
  const lossy = Buffer.alloc(14);
  lossy.set([0, 0, 0, 0x9d, 0x01, 0x2a], 0);
  lossy.writeUInt16LE(640, 6);
  lossy.writeUInt16LE(480, 8);
  assert.deepEqual(imageInfo(riff("VP8 ", lossy)), { type: "webp", width: 640, height: 480 });

  const lossless = Buffer.alloc(10);
  lossless[0] = 0x2f;
  lossless.writeUInt32LE(((100 - 1) & 0x3fff) | (((50 - 1) & 0x3fff) << 14), 1);
  assert.deepEqual(imageInfo(riff("VP8L", lossless)), { type: "webp", width: 100, height: 50 });

  const ext = Buffer.alloc(18);
  ext.writeUIntLE(1999, 4, 3);
  ext.writeUIntLE(999, 7, 3);
  assert.deepEqual(imageInfo(riff("VP8X", ext)), { type: "webp", width: 2000, height: 1000 });
});

test("anything else is null", () => {
  assert.equal(imageInfo(Buffer.from("GIF89a....................")), null);
  assert.equal(imageInfo(Buffer.alloc(3)), null);
  assert.equal(imageInfo(Buffer.from("<svg></svg>".padEnd(40))), null);
});
