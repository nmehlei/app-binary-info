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

export interface AxmlAttribute {
  nameIndex: number;
  rawValueIndex: number; // -1 if the value isn't a plain string reference
  dataType: number;
  data: number;
}

export function buildStartTagChunk(attributes: AxmlAttribute[]): Buffer {
  // ResXMLTree_attrExt is 20 bytes: ns(4) + name(4) + attributeStart(2) +
  // attributeSize(2) + attributeCount(2) + idIndex(2) + classIndex(2) +
  // styleIndex(2). Attribute records follow immediately after it.
  const attrExtHeaderSize = 20;
  const attrRecordSize = 20;
  const attrExt = Buffer.alloc(attrExtHeaderSize + attributes.length * attrRecordSize);
  attrExt.writeUInt32LE(0xffffffff, 0); // ns = -1 (none)
  attrExt.writeUInt32LE(0, 4); // name (string index for "manifest" - unused by the parser)
  attrExt.writeUInt16LE(attrExtHeaderSize, 8); // attributeStart, relative to this header
  attrExt.writeUInt16LE(attrRecordSize, 10); // attributeSize
  attrExt.writeUInt16LE(attributes.length, 12); // attributeCount
  attrExt.writeUInt16LE(0, 14); // idIndex
  attrExt.writeUInt16LE(0, 16); // classIndex
  attrExt.writeUInt16LE(0, 18); // styleIndex

  attributes.forEach((a, i) => {
    const off = attrExtHeaderSize + i * attrRecordSize;
    attrExt.writeUInt32LE(0xffffffff, off); // ns
    attrExt.writeUInt32LE(a.nameIndex, off + 4);
    attrExt.writeInt32LE(a.rawValueIndex, off + 8);
    attrExt.writeUInt16LE(8, off + 12); // typedValue.size
    attrExt.writeUInt8(0, off + 14); // typedValue.res0
    attrExt.writeUInt8(a.dataType, off + 15); // typedValue.dataType
    attrExt.writeUInt32LE(a.data, off + 16); // typedValue.data
  });

  const nodeHeader = Buffer.alloc(8); // lineNumber:u32, comment:u32 (-1 = none)
  nodeHeader.writeUInt32LE(1, 0);
  nodeHeader.writeInt32LE(-1, 4);

  return wrapChunk(0x0102, 16, Buffer.concat([nodeHeader, attrExt]));
}

/** A full minimal AXML document: outer RES_XML_TYPE header, one string
 * pool, one <manifest> START_TAG with the given attributes. */
export function buildMinimalManifestAxml(strings: string[], attributes: AxmlAttribute[]): Buffer {
  const pool = buildStringPoolChunk(strings, false);
  const startTag = buildStartTagChunk(attributes);
  const body = Buffer.concat([pool, startTag]);
  return wrapChunk(0x0003, 8, body);
}
