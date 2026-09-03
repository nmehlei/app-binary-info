import { readChunkHeader, parseStringPool } from "../../src/android/axml";
import { buildStringPoolChunk } from "../fixtures/bytes/axmlFixtures";

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
