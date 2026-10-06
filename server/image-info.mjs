/** Type and pixel size of a PNG, JPEG or WebP from its header bytes; null for anything else. */
export function imageInfo(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
    return sized("png", buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return jpeg(buf);
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return webp(buf);
  return null;
}

function sized(type, width, height) {
  return width > 0 && height > 0 ? { type, width, height } : null;
}

function jpeg(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return sized("jpeg", buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
    i += 2 + length;
  }
  return null;
}

function webp(buf) {
  const kind = buf.toString("ascii", 12, 16);
  if (kind === "VP8X") return sized("webp", 1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
  if (kind === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return sized("webp", (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (kind === "VP8 ") {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return sized("webp", buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  }
  return null;
}

/** Images above this many pixels are refused (decoders allocate width x height x 4 bytes). */
export const MAX_PIXELS = 100_000_000;
export const tooManyPixels = (info) => info.width * info.height > MAX_PIXELS;

export const EXTENSION = { png: "png", jpeg: "jpg", webp: "webp" };
