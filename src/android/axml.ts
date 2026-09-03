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

export interface AndroidManifestInfo {
  packageName: string;
  versionCode?: number;
  versionName?: string;
}

const TYPE_STRING = 0x03;

export function parseAndroidManifest(buf: Buffer): AndroidManifestInfo {
  if (buf.length < CHUNK_HEADER_SIZE) {
    throw new ParseError("AndroidManifest.xml is too short to be a valid binary XML file");
  }

  let offset = CHUNK_HEADER_SIZE; // skip the outer RES_XML_TYPE document chunk header
  let pool: StringPool | undefined;

  while (offset < buf.length) {
    const header = readChunkHeader(buf, offset);
    if (header.size <= 0 || offset + header.size > buf.length) {
      throw new ParseError(`malformed chunk at offset ${offset}: size ${header.size} exceeds buffer length ${buf.length}`);
    }

    if (header.type === RES_STRING_POOL_TYPE) {
      pool = parseStringPool(buf, offset, header);
    } else if (header.type === RES_XML_START_ELEMENT_TYPE) {
      if (!pool) throw new ParseError("found a START_TAG chunk before any string pool");
      return extractManifestAttributes(buf, offset, pool);
    }

    offset += header.size;
  }

  throw new ParseError("no <manifest> start tag found in AndroidManifest.xml");
}

function extractManifestAttributes(buf: Buffer, chunkStart: number, pool: StringPool): AndroidManifestInfo {
  // ResXMLTree_node: chunk header (8) + lineNumber:u32 + comment:u32 = 16
  // bytes before ResXMLTree_attrExt begins.
  const attrExtStart = chunkStart + 16;
  const attributeStart = buf.readUInt16LE(attrExtStart + 8);
  const attributeSize = buf.readUInt16LE(attrExtStart + 10);
  const attributeCount = buf.readUInt16LE(attrExtStart + 12);
  const attrsBase = attrExtStart + attributeStart;

  let packageName: string | undefined;
  let versionCode: number | undefined;
  let versionName: string | undefined;

  for (let i = 0; i < attributeCount; i++) {
    const attrOffset = attrsBase + i * attributeSize;
    const nameIdx = buf.readUInt32LE(attrOffset + 4);
    const rawValueIdx = buf.readInt32LE(attrOffset + 8);
    const dataType = buf.readUInt8(attrOffset + 15); // typedValue: size(2)+res0(1)+dataType(1) at +12
    const data = buf.readUInt32LE(attrOffset + 16);

    const attrName = pool.strings[nameIdx];
    if (attrName === "package") {
      packageName = rawValueIdx >= 0 ? pool.strings[rawValueIdx] : pool.strings[data];
    } else if (attrName === "versionCode") {
      versionCode = data;
    } else if (attrName === "versionName") {
      versionName = dataType === TYPE_STRING ? pool.strings[data] : String(data);
    }
  }

  if (!packageName) {
    throw new ParseError("AndroidManifest.xml's <manifest> tag has no package attribute");
  }
  return { packageName, versionCode, versionName };
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
