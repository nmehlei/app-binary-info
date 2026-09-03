import { ParseError } from "../errors";

const MAGIC = "bplist00";
const TRAILER_SIZE = 32;

/** Guards a structural read against a count/offset value that came from the
 * file itself, so a corrupted/truncated buffer throws ParseError instead of
 * a raw Node RangeError. */
function need(buf: Buffer, offset: number, len: number, what: string): void {
  if (offset < 0 || len < 0 || offset + len > buf.length) {
    throw new ParseError(`${what}: read of ${len} bytes at offset ${offset} is outside the ${buf.length}-byte buffer`);
  }
}

export function isBinaryPlist(buf: Buffer): boolean {
  return buf.length >= 8 && buf.toString("ascii", 0, 8) === MAGIC;
}

function readUInt(buf: Buffer, offset: number, size: number): number {
  need(buf, offset, size, "binary plist integer");
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + buf.readUInt8(offset + i);
  return value;
}

function readCount(buf: Buffer, offset: number, lowNibble: number): { count: number; headerLen: number } {
  if (lowNibble !== 0x0f) return { count: lowNibble, headerLen: 1 };
  // Extended: the next byte is an int-type marker whose own value is the real count.
  need(buf, offset + 1, 1, "binary plist extended count marker");
  const intMarker = buf.readUInt8(offset + 1);
  const intSize = 1 << (intMarker & 0x0f);
  const count = readUInt(buf, offset + 2, intSize);
  return { count, headerLen: 2 + intSize };
}

function decodeUtf16Be(buf: Buffer, start: number, charCount: number): string {
  const swapped = Buffer.alloc(charCount * 2);
  for (let i = 0; i < charCount; i++) {
    swapped[i * 2] = buf[start + i * 2 + 1];
    swapped[i * 2 + 1] = buf[start + i * 2];
  }
  return swapped.toString("utf16le");
}

/** Reads one object as a string. Only ASCII (marker 0x5_) and UTF-16BE
 * (marker 0x6_) are supported - every key/value this project reads out of
 * an Info.plist is one of those two in practice. */
function readStringObject(buf: Buffer, offset: number): string {
  need(buf, offset, 1, "binary plist object marker");
  const marker = buf.readUInt8(offset);
  const highNibble = marker >> 4;
  const lowNibble = marker & 0x0f;
  const { count, headerLen } = readCount(buf, offset, lowNibble);
  const start = offset + headerLen;
  if (highNibble === 0x5) {
    need(buf, start, count, "binary plist ASCII string data");
    return buf.toString("ascii", start, start + count);
  }
  if (highNibble === 0x6) {
    need(buf, start, count * 2, "binary plist UTF-16 string data");
    return decodeUtf16Be(buf, start, count);
  }
  throw new ParseError(`expected a string object in the binary plist, got type marker 0x${marker.toString(16)}`);
}

/**
 * Reads only the requested keys out of a binary plist's top-level
 * dictionary, as strings. Keys present but not requested are never
 * resolved - see this file's design note.
 */
export function readBinaryPlistStrings(buf: Buffer, keys: string[]): Record<string, string> {
  if (!isBinaryPlist(buf)) {
    throw new ParseError("not a binary plist (missing bplist00 magic)");
  }
  if (buf.length < 8 + TRAILER_SIZE) {
    throw new ParseError("binary plist is too short to contain a valid trailer");
  }

  const trailer = buf.subarray(buf.length - TRAILER_SIZE);
  const offsetIntSize = trailer.readUInt8(6);
  const objectRefSize = trailer.readUInt8(7);
  const numObjects = Number(trailer.readBigUInt64BE(8));
  const topObjectIndex = Number(trailer.readBigUInt64BE(16));
  const offsetTableOffset = Number(trailer.readBigUInt64BE(24));

  need(buf, offsetTableOffset, numObjects * offsetIntSize, "binary plist offset table");
  const objectOffsets: number[] = [];
  for (let i = 0; i < numObjects; i++) {
    objectOffsets.push(readUInt(buf, offsetTableOffset + i * offsetIntSize, offsetIntSize));
  }

  const resolveOffset = (ref: number): number => {
    if (ref < 0 || ref >= objectOffsets.length) {
      throw new ParseError(`binary plist object reference ${ref} is outside the ${objectOffsets.length}-entry offset table`);
    }
    const off = objectOffsets[ref];
    need(buf, off, 0, "binary plist object");
    return off;
  };

  const rootOffset = resolveOffset(topObjectIndex);
  const rootMarker = buf.readUInt8(rootOffset);
  if (rootMarker >> 4 !== 0xd) {
    throw new ParseError("binary plist's top-level object is not a dictionary");
  }
  const { count, headerLen } = readCount(buf, rootOffset, rootMarker & 0x0f);
  const refsStart = rootOffset + headerLen;
  need(buf, refsStart, count * objectRefSize * 2, "binary plist dictionary key/value refs");

  const result: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const keyRef = readUInt(buf, refsStart + i * objectRefSize, objectRefSize);
    const key = readStringObject(buf, resolveOffset(keyRef));
    if (!keys.includes(key)) continue;
    const valueRef = readUInt(buf, refsStart + count * objectRefSize + i * objectRefSize, objectRefSize);
    result[key] = readStringObject(buf, resolveOffset(valueRef));
  }
  return result;
}
