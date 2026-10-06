import zlib from "node:zlib";

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf);
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * A store-only (no compression) zip writer, enough for PNG files, which do not compress further.
 * `write(chunk)` receives the bytes in order; call `add(name, data)` for each file, then `finish()`.
 * Names must be plain ASCII (the caller sanitises); archives stay under 4 GB and 65535 entries.
 */
export function createZipWriter(write) {
  const central = [];
  let offset = 0;
  const { time, day } = dosTime(new Date());
  const emit = async (buf) => {
    offset += buf.length;
    await write(buf);
  };
  return {
    async add(name, data) {
      const nameBytes = Buffer.from(name, "ascii");
      const crc = crc32(data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0, 6); // flags
      local.writeUInt16LE(0, 8); // method: stored
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(day, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      central.push({ nameBytes, crc, size: data.length, offset });
      await emit(local);
      await emit(nameBytes);
      await emit(data);
    },
    async finish() {
      const start = offset;
      for (const e of central) {
        const head = Buffer.alloc(46);
        head.writeUInt32LE(0x02014b50, 0);
        head.writeUInt16LE(20, 4); // made by
        head.writeUInt16LE(20, 6); // needed
        head.writeUInt16LE(0, 8);
        head.writeUInt16LE(0, 10);
        head.writeUInt16LE(time, 12);
        head.writeUInt16LE(day, 14);
        head.writeUInt32LE(e.crc, 16);
        head.writeUInt32LE(e.size, 20);
        head.writeUInt32LE(e.size, 24);
        head.writeUInt16LE(e.nameBytes.length, 28);
        head.writeUInt32LE(e.offset, 42);
        await emit(head);
        await emit(e.nameBytes);
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(central.length, 8);
      end.writeUInt16LE(central.length, 10);
      end.writeUInt32LE(offset - start, 12);
      end.writeUInt32LE(start, 16);
      await emit(end);
    },
  };
}
