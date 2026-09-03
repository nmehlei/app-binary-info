import path from "path";
import fs from "fs";
import { isBinaryPlist, readBinaryPlistStrings } from "../../src/ios/bplist";
import { ParseError } from "../../src/errors";

const REAL_BPLIST = path.join(__dirname, "../fixtures/real/Info-binary.plist");

test("isBinaryPlist is true for a real bplist00 file", () => {
  const buf = fs.readFileSync(REAL_BPLIST);
  expect(isBinaryPlist(buf)).toBe(true);
});

test("isBinaryPlist is false for an XML plist", () => {
  expect(isBinaryPlist(Buffer.from("<?xml version=\"1.0\"?>"))).toBe(false);
});

test("isBinaryPlist is false for a too-short buffer", () => {
  expect(isBinaryPlist(Buffer.from("bpl"))).toBe(false);
});

test("readBinaryPlistStrings reads the requested keys from a real plutil-generated bplist", () => {
  const buf = fs.readFileSync(REAL_BPLIST);
  const values = readBinaryPlistStrings(buf, [
    "CFBundleIdentifier",
    "CFBundleShortVersionString",
    "CFBundleVersion",
  ]);
  expect(values).toEqual({
    CFBundleIdentifier: "com.example.SampleApp",
    CFBundleShortVersionString: "1.2.3",
    CFBundleVersion: "42",
  });
});

test("readBinaryPlistStrings ignores keys not requested, even if present", () => {
  const buf = fs.readFileSync(REAL_BPLIST);
  const values = readBinaryPlistStrings(buf, ["CFBundleIdentifier"]);
  expect(values).toEqual({ CFBundleIdentifier: "com.example.SampleApp" });
  expect(values).not.toHaveProperty("CFBundleVersion");
});

test("readBinaryPlistStrings returns an empty object when a requested key isn't present", () => {
  const buf = fs.readFileSync(REAL_BPLIST);
  const values = readBinaryPlistStrings(buf, ["NotAKey"]);
  expect(values).toEqual({});
});

test("throws ParseError for a non-bplist buffer", () => {
  expect(() => readBinaryPlistStrings(Buffer.from("not a plist"), ["x"])).toThrow(ParseError);
});

test("throws ParseError for a truncated bplist (shorter than a valid trailer)", () => {
  expect(() => readBinaryPlistStrings(Buffer.from("bplist00"), ["x"])).toThrow(ParseError);
});

test("readBinaryPlistStrings throws ParseError, not a raw RangeError, for a corrupted numObjects", () => {
  const buf = fs.readFileSync(REAL_BPLIST);
  const corrupted = Buffer.from(buf);
  const trailerStart = corrupted.length - 32;
  corrupted.writeBigUInt64BE(BigInt(0xffffffff), trailerStart + 8); // numObjects, way beyond the real object count
  expect(() => readBinaryPlistStrings(corrupted, ["CFBundleIdentifier"])).toThrow(ParseError);
});

test("readBinaryPlistStrings throws ParseError, not a raw RangeError, for a corrupted offsetTableOffset", () => {
  const buf = fs.readFileSync(REAL_BPLIST);
  const corrupted = Buffer.from(buf);
  const trailerStart = corrupted.length - 32;
  corrupted.writeBigUInt64BE(BigInt(corrupted.length + 1000), trailerStart + 24); // offsetTableOffset, past EOF
  expect(() => readBinaryPlistStrings(corrupted, ["CFBundleIdentifier"])).toThrow(ParseError);
});

test("readBinaryPlistStrings throws ParseError, not a raw RangeError, for a corrupted topObjectIndex", () => {
  const buf = fs.readFileSync(REAL_BPLIST);
  const corrupted = Buffer.from(buf);
  const trailerStart = corrupted.length - 32;
  corrupted.writeBigUInt64BE(BigInt(999999), trailerStart + 16); // topObjectIndex, outside the offset table
  expect(() => readBinaryPlistStrings(corrupted, ["CFBundleIdentifier"])).toThrow(ParseError);
});

test("reads a short (non-extended-count) string correctly - the real fixture's values are all long enough to need extended encoding, so this covers the other branch", () => {
  // Hand-built minimal bplist: one dict {"a": "hi"} - both key and value
  // short enough to fit their count directly in the marker's low nibble.
  // Object 0 is the dict itself: marker 0xd1 (dict, count=1), then the
  // dict body is [keyRefs..., valueRefs...] = [1, 2] (object #1 is the
  // key, object #2 is the value).
  const dictObj = Buffer.from([0xd1, 0x01, 0x02]);
  const keyObj = Buffer.from([0x51, "a".charCodeAt(0)]); // ASCII string, count=1, "a"
  const valueObj = Buffer.from([0x52, ...Buffer.from("hi", "ascii")]); // ASCII string, count=2, "hi"

  const objects = [dictObj, keyObj, valueObj];
  let offset = 8; // after "bplist00"
  const offsets: number[] = [];
  const objectBytes: Buffer[] = [];
  for (const obj of objects) {
    offsets.push(offset);
    objectBytes.push(obj);
    offset += obj.length;
  }
  const offsetTableOffset = offset;
  const offsetTable = Buffer.from(offsets);

  const trailer = Buffer.alloc(32);
  trailer.writeUInt8(1, 6); // offsetIntSize
  trailer.writeUInt8(1, 7); // objectRefSize
  trailer.writeBigUInt64BE(BigInt(3), 8); // numObjects
  trailer.writeBigUInt64BE(BigInt(0), 16); // topObjectIndex (the dict is object 0)
  trailer.writeBigUInt64BE(BigInt(offsetTableOffset), 24);

  const buf = Buffer.concat([Buffer.from("bplist00", "ascii"), ...objectBytes, offsetTable, trailer]);
  const values = readBinaryPlistStrings(buf, ["a"]);
  expect(values).toEqual({ a: "hi" });
});
