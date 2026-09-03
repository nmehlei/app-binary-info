import path from "path";
import { readChunkHeader, parseStringPool, parseAndroidManifest } from "../../src/android/axml";
import { readZipEntry } from "../../src/zip";
import { ParseError } from "../../src/errors";
import { buildMinimalManifestAxml, buildStringPoolChunk, wrapChunk } from "../fixtures/bytes/axmlFixtures";

test("readChunkHeader reads type, headerSize, size as little-endian", () => {
  const buf = buildStringPoolChunk(["hello"], false);
  const header = readChunkHeader(buf, 0);
  expect(header.type).toBe(0x0001);
  expect(header.headerSize).toBe(28);
  expect(header.size).toBe(buf.length);
});

test("parseStringPool reads UTF-16 encoded strings", () => {
  const buf = buildStringPoolChunk(["package", "versionName"], false);
  const header = readChunkHeader(buf, 0);
  const pool = parseStringPool(buf, 0, header);
  expect(pool.strings).toEqual(["package", "versionName"]);
});

test("parseStringPool reads UTF-8 encoded strings", () => {
  const buf = buildStringPoolChunk(["package", "versionName"], true);
  const header = readChunkHeader(buf, 0);
  const pool = parseStringPool(buf, 0, header);
  expect(pool.strings).toEqual(["package", "versionName"]);
});

test("parseStringPool handles an empty string pool", () => {
  const buf = buildStringPoolChunk([], false);
  const header = readChunkHeader(buf, 0);
  const pool = parseStringPool(buf, 0, header);
  expect(pool.strings).toEqual([]);
});

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;

test("parseAndroidManifest reads package, versionCode, versionName by attribute name", () => {
  // string pool: [0]="package" [1]="com.example.app" [2]="versionName" [3]="1.2.3" [4]="versionCode" [5]="manifest"
  const buf = buildMinimalManifestAxml(
    ["package", "com.example.app", "versionName", "1.2.3", "versionCode", "manifest"],
    [
      { nameIndex: 0, rawValueIndex: 1, dataType: TYPE_STRING, data: 1 },
      { nameIndex: 2, rawValueIndex: 3, dataType: TYPE_STRING, data: 3 },
      { nameIndex: 4, rawValueIndex: -1, dataType: TYPE_INT_DEC, data: 42 },
    ]
  );
  const info = parseAndroidManifest(buf);
  expect(info.packageName).toBe("com.example.app");
  expect(info.versionName).toBe("1.2.3");
  expect(info.versionCode).toBe(42);
});

test("parseAndroidManifest against a real compiled manifest", async () => {
  const manifestPath = path.join(__dirname, "../fixtures/real/selendroid-test-app.apk");
  const buf = await readZipEntry(manifestPath, "AndroidManifest.xml");
  const info = parseAndroidManifest(buf!);
  expect(info.packageName).toBe("io.selendroid.testapp");
});

test("parseAndroidManifest throws ParseError when there's no manifest tag", () => {
  const pool = buildStringPoolChunk(["x"], false);
  const buf = wrapChunk(0x0003, 8, pool); // string pool only, no START_TAG chunk at all
  expect(() => parseAndroidManifest(buf)).toThrow("no <manifest> start tag found");
});

test("parseAndroidManifest throws ParseError when the manifest tag has no package attribute", () => {
  const buf = buildMinimalManifestAxml(["versionName"], []);
  expect(() => parseAndroidManifest(buf)).toThrow("no package attribute");
});

test("parseStringPool throws ParseError, not a raw RangeError, for a corrupted stringCount", () => {
  const buf = buildStringPoolChunk(["package", "versionName"], false);
  const corrupted = Buffer.from(buf);
  corrupted.writeUInt32LE(0xffffff, 8); // stringCount field, way beyond the real string data
  const header = readChunkHeader(corrupted, 0);
  expect(() => parseStringPool(corrupted, 0, header)).toThrow(ParseError);
});

test("parseAndroidManifest throws ParseError, not a raw RangeError, for a corrupted attributeCount", () => {
  const strings = ["package", "com.example.app", "manifest"];
  const buf = buildMinimalManifestAxml(strings, [{ nameIndex: 0, rawValueIndex: 1, dataType: TYPE_STRING, data: 1 }]);
  const corrupted = Buffer.from(buf);

  // Layout: outer doc header (8) + string pool chunk + START_TAG chunk
  // header (8) + node header (8) + attrExt header, whose attributeCount
  // field sits at offset 12 within the attrExt header.
  const pool = buildStringPoolChunk(strings, false);
  const attributeCountOffset = 8 + pool.length + 8 + 8 + 12;
  corrupted.writeUInt16LE(0xffff, attributeCountOffset);

  expect(() => parseAndroidManifest(corrupted)).toThrow(ParseError);
});
