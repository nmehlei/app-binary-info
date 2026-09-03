import { ParseError } from "../errors";

export const RES_STRING_POOL_TYPE = 0x0001;
export const RES_XML_START_ELEMENT_TYPE = 0x0102;
const UTF8_FLAG = 1 << 8;
const CHUNK_HEADER_SIZE = 8;

export interface ChunkHeader {
  type: number;
  headerSize: number;
  size: number;
}

export function readChunkHeader(buf: Buffer, offset: number): ChunkHeader {
  return {
    type: buf.readUInt16LE(offset),
    headerSize: buf.readUInt16LE(offset + 2),
    size: buf.readUInt32LE(offset + 4),
  };
}

export interface StringPool {
  strings: string[];
}

export function parseStringPool(buf: Buffer, chunkStart: number, header: ChunkHeader): StringPool {
  const stringCount = buf.readUInt32LE(chunkStart + 8);
  const flags = buf.readUInt32LE(chunkStart + 16);
  const stringsStart = buf.readUInt32LE(chunkStart + 20);
  const isUtf8 = (flags & UTF8_FLAG) !== 0;

  const offsetsStart = chunkStart + header.headerSize;
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const relOffset = buf.readUInt32LE(offsetsStart + i * 4);
    const stringOffset = chunkStart + stringsStart + relOffset;
    strings.push(isUtf8 ? readUtf8PoolString(buf, stringOffset) : readUtf16PoolString(buf, stringOffset));
  }
  return { strings };
}

function readUtf16PoolString(buf: Buffer, offset: number): string {
  const charCount = buf.readUInt16LE(offset);
  const start = offset + 2;
  return buf.toString("utf16le", start, start + charCount * 2);
}

function readUtf8PoolString(buf: Buffer, offset: number): string {
  // UTF-8 pool entries are length-prefixed twice (char count, then byte
  // length) - each prefix is one byte unless its high bit is set, in which
  // case a second byte extends it. Fixtures in this project never exceed
  // one byte, but real large manifests could, so both are decoded properly.
  let pos = offset;
  const readLen = (): number => {
    const first = buf.readUInt8(pos);
    pos += 1;
    if ((first & 0x80) === 0) return first;
    const second = buf.readUInt8(pos);
    pos += 1;
    return ((first & 0x7f) << 8) | second;
  };
  readLen(); // character count - not needed; byte length below is what we read
  const byteLen = readLen();
  return buf.toString("utf8", pos, pos + byteLen);
}
