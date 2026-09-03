/** Builds a minimal string pool chunk (RES_STRING_POOL_TYPE = 0x0001). */
export function buildStringPoolChunk(strings: string[], utf8: boolean): Buffer {
  const headerSize = 28;
  const offsets: number[] = [];
  const dataParts: Buffer[] = [];
  let cursor = 0;
  for (const s of strings) {
    offsets.push(cursor);
    const part = utf8 ? encodeUtf8PoolString(s) : encodeUtf16PoolString(s);
    dataParts.push(part);
    cursor += part.length;
  }
  const stringData = Buffer.concat(dataParts);
  const offsetsBuf = Buffer.alloc(strings.length * 4);
  offsets.forEach((o, i) => offsetsBuf.writeUInt32LE(o, i * 4));

  const stringsStart = headerSize + offsetsBuf.length;
  const poolHeader = Buffer.alloc(headerSize - 8);
  poolHeader.writeUInt32LE(strings.length, 0); // stringCount
  poolHeader.writeUInt32LE(0, 4); // styleCount
  poolHeader.writeUInt32LE(utf8 ? 1 << 8 : 0, 8); // flags (bit 8 = UTF8_FLAG)
  poolHeader.writeUInt32LE(stringsStart, 12); // stringsStart
  poolHeader.writeUInt32LE(0, 16); // stylesStart

  const body = Buffer.concat([poolHeader, offsetsBuf, stringData]);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt16LE(0x0001, 0);
  chunkHeader.writeUInt16LE(headerSize, 2);
  chunkHeader.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([chunkHeader, body]);
}

function encodeUtf16PoolString(s: string): Buffer {
  const chars = Buffer.from(s, "utf16le");
  const len = Buffer.alloc(2);
  len.writeUInt16LE(s.length, 0);
  return Buffer.concat([len, chars, Buffer.from([0, 0])]);
}

function encodeUtf8PoolString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  // Single-byte length prefixes only - every fixture string here is well
  // under 0x80 in both char count and byte count.
  return Buffer.concat([Buffer.from([s.length]), Buffer.from([bytes.length]), bytes, Buffer.from([0])]);
}

/** Wraps a chunk's body in a chunk of the given type, computing size/headerSize. */
export function wrapChunk(type: number, headerSize: number, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(headerSize, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}
