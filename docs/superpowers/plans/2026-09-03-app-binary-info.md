# app-binary-info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish `app-binary-info`, a TypeScript library that reads an app's identity (Android package name; iOS bundle id) and version straight out of its own built binary (`.apk`/`.ipa`), with zero dependencies beyond a zip reader.

**Architecture:** A thin zip-reading layer (`yauzl`) feeds two independent, hand-rolled binary-format parsers — Android Binary XML (`AndroidManifest.xml`) and Apple's binary/XML plist (`Info.plist`) — behind a small public API (`parse`, `parseApk`, `parseIpa`). Phase 1 (Tasks 1–7) ships a fully working, testable Android-only `parseApk()`. Phase 2 (Tasks 8–13) adds iOS support and the unified auto-detecting `parse()`.

**Tech Stack:** TypeScript 5.5, `yauzl@3.4.0` (the one dependency), `tsup@8.5.1` (dual ESM+CJS build), `jest@30.5.1`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-initial-design.md`

## Global Constraints

- CJS output is required, not optional — MobileDeviceFarm (the first real consumer) compiles under `"module": "commonjs"`.
- Zero runtime dependencies except `yauzl`.
- Every parser function that can receive malformed/unexpected input throws `UnsupportedFileError` (not a recognizable app binary at all) or `ParseError` (recognized format, malformed contents) — never a raw error from `yauzl` or a bare `TypeError`.
- All byte-format code in this plan (AXML chunk header, AXML string pool, binary plist trailer/object table) was verified against real files during design — see "Verified ground truth" below. AXML attribute-record parsing (Task 5) was **not** independently byte-verified and must be debugged against the real fixture if its test fails on the first attempt — see that task's note.

### Verified ground truth (for context, not to be re-derived)

Extracted from a real, downloaded APK (`tests/fixtures/real/selendroid-test-app.apk`, Appium's public sample app, Apache-2.0, package name `io.selendroid.testapp`) and a real `plutil`-generated binary plist (`tests/fixtures/real/Info-binary.plist`):

- AXML chunk header: `u16 type, u16 headerSize, u32 size`, all little-endian, 8 bytes total.
- AXML string pool (non-UTF8 flag): after the pool's own header fields, an array of `stringCount × u32` offsets, then string data — each UTF-16 string is `u16 charCount` + UTF-16LE chars + `u16 0x0000` terminator.
- Binary plist: magic `bplist00` (8 bytes), then an object table, then an offset table, then a 32-byte trailer (6 bytes unused, `u8 offsetIntSize`, `u8 objectRefSize`, `u64 BE numObjects`, `u64 BE topObjectIndex`, `u64 BE offsetTableOffset`). Object markers: high nibble selects type (`0x0`=null/bool, `0x1`=int, `0x5`=ASCII string, `0x6`=UTF-16BE string, `0xa`=array, `0xd`=dict); low nibble is the count, or `0xf` meaning "read the next byte as an int-type marker whose value is the real count."

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `jest.config.js`, `.gitignore`, `eslint.config.js`, `README.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**Interfaces:**
- Produces: a working `npm run build`, `npm test`, `npm run typecheck`, `npm run lint` — every later task depends on these existing.

- [ ] **Step 1: Write `package.json`**

`"version"` here is a local-dev placeholder only — the release workflow (Step 9) overwrites it from GitVersion right before `npm publish` and never commits that change, so this field never needs manual bumping.

```json
{
  "name": "app-binary-info",
  "version": "0.1.0",
  "description": "Zero-dependency (besides a zip reader) parser for Android APK and iOS IPA app metadata - package/bundle id, version name and code, straight from the binary.",
  "license": "MIT",
  "type": "commonjs",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "test": "jest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests"
  },
  "dependencies": {
    "yauzl": "3.4.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^20.11.30",
    "@types/yauzl": "3.4.0",
    "@typescript-eslint/eslint-plugin": "^8.5.0",
    "@typescript-eslint/parser": "^8.5.0",
    "eslint": "^9.9.0",
    "jest": "30.5.1",
    "ts-jest": "^29.2.5",
    "tsup": "8.5.1",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Write `jest.config.js`**

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
};
```

- [ ] **Step 5: Write `eslint.config.js`**

```js
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");

module.exports = [
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
];
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 7: Write `README.md`**

```markdown
# app-binary-info

Reads an app's identity straight out of its own built binary — no separate
config to keep in sync, no `aapt`/Xcode toolchain required.

```ts
import { parse, parseApk, parseIpa } from "app-binary-info";

const info = await parseApk("./app-release.apk");
// { platform: "android", packageName: "com.example.app", versionName: "1.2.3", versionCode: 42 }

const iosInfo = await parseIpa("./App.ipa");
// { platform: "ios", bundleId: "com.example.App", versionName: "1.2.3", buildNumber: "42" }

const auto = await parse(someApkOrIpaPathOrBuffer); // auto-detects
```

## Why

Config-driven app identity (a value someone types into a dashboard or env
var) can silently drift from what's actually in the binary you're about to
install. This reads it from the one place that can't be stale — the binary
itself.

## Scope

Android APK + iOS IPA. Package/bundle id, version name, version code/build
number. Read-only. See `docs/superpowers/specs/2026-09-03-initial-design.md`
for the full design rationale.

## License

MIT
```

- [ ] **Step 8: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

- [ ] **Step 9: Write `.github/workflows/release.yml`**

Version comes from GitVersion (MainLine mode), not a hand-maintained `package.json` field — `npm version` is used only to stamp the computed version into `package.json` right before publish, never committed.

```yaml
name: Release
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gittools/actions/gitversion/setup@v3
        with:
          versionSpec: "5.x"
      - id: gitversion
        uses: gittools/actions/gitversion/execute@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm version ${{ steps.gitversion.outputs.semVer }} --no-git-tag-version --allow-same-version
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 10: Write `GitVersion.yml`**

```yaml
mode: Mainline
branches:
  main:
    regex: ^main$
    increment: Patch
```

- [ ] **Step 11: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 12: Verify the empty scaffold builds and lints clean**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0 (there's no `src/` yet, so typecheck has nothing to check — this just confirms the toolchain itself is wired correctly. If `tsc` complains about no input files, create an empty `src/index.ts` with just `export {};` first.)

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts jest.config.js eslint.config.js .gitignore README.md .github GitVersion.yml
git commit -m "chore: project scaffold (build, test, lint, CI/release workflows, GitVersion)"
```

---

## Task 2: Error types

**Files:**
- Create: `src/errors.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Produces: `UnsupportedFileError`, `ParseError` — every later parsing task throws these.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/errors.test.ts
import { UnsupportedFileError, ParseError } from "../../src/errors";

test("UnsupportedFileError is a real Error with the right name and message", () => {
  const err = new UnsupportedFileError("not a zip");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("UnsupportedFileError");
  expect(err.message).toBe("not a zip");
});

test("ParseError is a real Error with the right name and message", () => {
  const err = new ParseError("bad chunk");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("ParseError");
  expect(err.message).toBe("bad chunk");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/errors.test.ts`
Expected: FAIL — cannot find module `../../src/errors`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/errors.ts

/** Thrown when the input isn't a recognizable app binary at all - not a
 * zip, or a zip with neither an AndroidManifest.xml nor a
 * Payload/*.app/Info.plist entry. */
export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFileError";
  }
}

/** Thrown when the right entry was found, but its contents don't parse -
 * corrupt file, or a real format variant this parser doesn't handle yet. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/unit/errors.test.ts
git commit -m "feat: error types (UnsupportedFileError, ParseError)"
```

---

## Task 3: Zip reading layer

**Files:**
- Create: `src/zip.ts`
- Test: `tests/unit/zip.test.ts`

**Interfaces:**
- Consumes: `UnsupportedFileError` from `src/errors.ts`.
- Produces: `readZipEntry(input: string | Buffer, entryName: string): Promise<Buffer | undefined>`, `findZipEntryName(input: string | Buffer, predicate: (name: string) => boolean): Promise<string | undefined>`, `listZipEntryNames(input: string | Buffer): Promise<string[]>` — every later task reads app binaries through these three functions only, never `yauzl` directly.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/zip.test.ts
import path from "path";
import { readZipEntry, findZipEntryName, listZipEntryNames } from "../../src/zip";
import { UnsupportedFileError } from "../../src/errors";

const APK_FIXTURE = path.join(__dirname, "../fixtures/real/selendroid-test-app.apk");

test("listZipEntryNames lists every entry including AndroidManifest.xml", async () => {
  const names = await listZipEntryNames(APK_FIXTURE);
  expect(names).toContain("AndroidManifest.xml");
  expect(names.length).toBeGreaterThan(1);
});

test("readZipEntry reads a named entry's contents", async () => {
  const buf = await readZipEntry(APK_FIXTURE, "AndroidManifest.xml");
  expect(buf).toBeInstanceOf(Buffer);
  expect(buf!.length).toBeGreaterThan(0);
});

test("readZipEntry returns undefined for a name that doesn't exist", async () => {
  const buf = await readZipEntry(APK_FIXTURE, "does/not/exist.xml");
  expect(buf).toBeUndefined();
});

test("findZipEntryName returns the first entry matching a predicate", async () => {
  const name = await findZipEntryName(APK_FIXTURE, (n) => n.endsWith(".xml"));
  expect(name).toBe("AndroidManifest.xml");
});

test("findZipEntryName returns undefined when nothing matches", async () => {
  const name = await findZipEntryName(APK_FIXTURE, (n) => n.endsWith(".doesnotexist"));
  expect(name).toBeUndefined();
});

test("works from a Buffer, not just a file path", async () => {
  const fs = require("fs");
  const buf = fs.readFileSync(APK_FIXTURE);
  const names = await listZipEntryNames(buf);
  expect(names).toContain("AndroidManifest.xml");
});

test("a non-zip input throws UnsupportedFileError", async () => {
  await expect(listZipEntryNames(Buffer.from("not a zip file at all"))).rejects.toThrow(UnsupportedFileError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/zip.test.ts`
Expected: FAIL — cannot find module `../../src/zip`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/zip.ts
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { UnsupportedFileError } from "./errors";

function openZip(input: string | Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, zipfile?: ZipFile) => {
      if (err || !zipfile) {
        reject(new UnsupportedFileError(`not a valid zip file: ${err?.message ?? "unknown error"}`));
        return;
      }
      resolve(zipfile);
    };
    if (typeof input === "string") {
      yauzl.open(input, { lazyEntries: true }, cb);
    } else {
      yauzl.fromBuffer(input, { lazyEntries: true }, cb);
    }
  });
}

function readEntryStream(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("failed to open zip entry stream"));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

/** Lists every entry name in the zip, in central-directory order. */
export function listZipEntryNames(input: string | Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    openZip(input).then((zipfile) => {
      const names: string[] = [];
      zipfile.on("entry", (entry: Entry) => {
        names.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve(names));
      zipfile.on("error", reject);
      zipfile.readEntry();
    }, reject);
  });
}

/** Reads one named entry's full contents, or undefined if no entry has that exact name. */
export function readZipEntry(input: string | Buffer, entryName: string): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    openZip(input).then((zipfile) => {
      let found = false;
      zipfile.on("entry", (entry: Entry) => {
        if (entry.fileName === entryName) {
          found = true;
          readEntryStream(zipfile, entry).then((buf) => {
            zipfile.close();
            resolve(buf);
          }, reject);
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on("end", () => {
        if (!found) resolve(undefined);
      });
      zipfile.on("error", reject);
      zipfile.readEntry();
    }, reject);
  });
}

/** Finds the first entry name matching a predicate, or undefined. */
export function findZipEntryName(
  input: string | Buffer,
  predicate: (name: string) => boolean
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    openZip(input).then((zipfile) => {
      let found: string | undefined;
      zipfile.on("entry", (entry: Entry) => {
        if (found === undefined && predicate(entry.fileName)) {
          found = entry.fileName;
        }
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve(found));
      zipfile.on("error", reject);
      zipfile.readEntry();
    }, reject);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/zip.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/zip.ts tests/unit/zip.test.ts
git commit -m "feat: zip reading layer (readZipEntry, findZipEntryName, listZipEntryNames)"
```

---

## Task 4: AXML string pool + chunk walking

**Files:**
- Create: `src/android/axml.ts` (this task writes the string-pool half only; Task 5 adds attribute extraction to the same file)
- Create: `tests/fixtures/bytes/axmlFixtures.ts`
- Test: `tests/unit/axml.test.ts` (this task's tests only — Task 5 extends this file)

**Interfaces:**
- Consumes: `ParseError` from `src/errors.ts`.
- Produces: internal (not exported from `index.ts`) `readChunkHeader`, `parseStringPool` — Task 5 builds on these within the same file.

- [ ] **Step 1: Write the byte-fixture builder**

```ts
// tests/fixtures/bytes/axmlFixtures.ts

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
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/axml.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/axml.test.ts`
Expected: FAIL — cannot find module `../../src/android/axml`

- [ ] **Step 4: Write minimal implementation**

```ts
// src/android/axml.ts
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
```

Note: `parseAndroidManifest` (the exported entry point that walks chunks and calls this) is added in Task 5 — this task deliberately stops at the string-pool primitives so its test can focus narrowly on the pool encoding.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/axml.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/android/axml.ts tests/fixtures/bytes/axmlFixtures.ts tests/unit/axml.test.ts
git commit -m "feat: AXML chunk header + string pool parsing"
```

---

## Task 5: AXML manifest attribute extraction

**Files:**
- Modify: `src/android/axml.ts` (add `parseAndroidManifest`)
- Modify: `tests/fixtures/bytes/axmlFixtures.ts` (add `buildStartTagChunk`, `buildMinimalManifestAxml`)
- Modify: `tests/unit/axml.test.ts` (add this task's tests)

**Interfaces:**
- Consumes: `readChunkHeader`, `parseStringPool`, `RES_STRING_POOL_TYPE`, `RES_XML_START_ELEMENT_TYPE` from Task 4 (same file).
- Produces: `parseAndroidManifest(buf: Buffer): { packageName: string; versionCode?: number; versionName?: string }` — Task 6 (`android/apk.ts`) calls this directly.

**⚠️ Note before starting:** the AXML chunk header and string pool format (Task 4) were verified byte-by-byte against a real compiled manifest during design. The attribute-record layout below (`ResXMLTree_attrExt`/`ResXMLTree_attribute`) is based on the well-documented, stable AOSP structures but was **not** independently verified against real bytes in the same way. If Step 6's test against the real fixture fails, debug it by hexdumping `tests/fixtures/real/selendroid-test-app.apk`'s extracted `AndroidManifest.xml` entry (`unzip -p tests/fixtures/real/selendroid-test-app.apk AndroidManifest.xml | xxd`) starting right after the string pool chunk (whose end you can compute from its own `size` field) and comparing field-by-field against the struct layout in Step 4's code — the same technique used to verify the string pool during design.

- [ ] **Step 1: Add fixture builders**

```ts
// tests/fixtures/bytes/axmlFixtures.ts - add these to the existing file

export interface AxmlAttribute {
  nameIndex: number;
  rawValueIndex: number; // -1 if the value isn't a plain string reference
  dataType: number;
  data: number;
}

export function buildStartTagChunk(attributes: AxmlAttribute[]): Buffer {
  const attrExtHeaderSize = 8;
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
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/axml.test.ts - add these tests, and this import, to the existing file
import path from "path";
import { parseAndroidManifest } from "../../src/android/axml";
import { readZipEntry } from "../../src/zip";
import { buildMinimalManifestAxml, buildStringPoolChunk, wrapChunk } from "../fixtures/bytes/axmlFixtures";

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/axml.test.ts`
Expected: FAIL — `parseAndroidManifest` is not exported

- [ ] **Step 4: Write minimal implementation**

```ts
// src/android/axml.ts - add to the existing file

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/axml.test.ts`
Expected: PASS for every test except possibly the real-fixture test (see next step)

- [ ] **Step 6: If the real-fixture test fails, debug against real bytes**

Run: `unzip -p tests/fixtures/real/selendroid-test-app.apk AndroidManifest.xml | xxd | less`

Compare the bytes right after the string pool chunk's end (`stringPoolChunkStart + stringPoolChunk.size`) against the `ResXMLTree_node`/`ResXMLTree_attrExt`/attribute-record field offsets in Step 4's code, adjusting them to match what the real file actually contains. This is expected debugging work, not a sign the plan is wrong in general — see this task's header note.

- [ ] **Step 7: Run the full test file once more to confirm everything passes**

Run: `npx jest tests/unit/axml.test.ts`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add src/android/axml.ts tests/fixtures/bytes/axmlFixtures.ts tests/unit/axml.test.ts
git commit -m "feat: AXML manifest attribute extraction (package, versionCode, versionName)"
```

---

## Task 6: parseApk — Android public entry point

**Files:**
- Create: `src/android/apk.ts`
- Test: `tests/integration/parseApk.test.ts`

**Interfaces:**
- Consumes: `readZipEntry` (`src/zip.ts`, Task 3), `parseAndroidManifest` (`src/android/axml.ts`, Task 5), `UnsupportedFileError` (`src/errors.ts`, Task 2).
- Produces: `AndroidAppInfo { platform: "android"; packageName: string; versionName?: string; versionCode?: number }`, `parseApk(input: string | Buffer): Promise<AndroidAppInfo>` — Task 11 (`detect.ts`) and the public `index.ts` (Task 12) both depend on this exact export.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/parseApk.test.ts
import path from "path";
import fs from "fs";
import { parseApk } from "../../src/android/apk";
import { UnsupportedFileError } from "../../src/errors";

const APK_FIXTURE = path.join(__dirname, "../fixtures/real/selendroid-test-app.apk");

test("parses a real APK from a file path", async () => {
  const info = await parseApk(APK_FIXTURE);
  expect(info).toEqual({
    platform: "android",
    packageName: "io.selendroid.testapp",
    versionCode: expect.any(Number),
    versionName: expect.any(String),
  });
});

test("parses the same real APK from a Buffer", async () => {
  const buf = fs.readFileSync(APK_FIXTURE);
  const info = await parseApk(buf);
  expect(info.packageName).toBe("io.selendroid.testapp");
});

test("a zip with no AndroidManifest.xml throws UnsupportedFileError", async () => {
  const AdmZipFixture = path.join(__dirname, "../fixtures/real/sample.ipa"); // a real zip, but not an APK
  await expect(parseApk(AdmZipFixture)).rejects.toThrow(UnsupportedFileError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/parseApk.test.ts`
Expected: FAIL — cannot find module `../../src/android/apk`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/android/apk.ts
import { readZipEntry } from "../zip";
import { parseAndroidManifest } from "./axml";
import { UnsupportedFileError } from "../errors";

export interface AndroidAppInfo {
  platform: "android";
  packageName: string;
  versionName?: string;
  versionCode?: number;
}

export async function parseApk(input: string | Buffer): Promise<AndroidAppInfo> {
  const manifestBuf = await readZipEntry(input, "AndroidManifest.xml");
  if (!manifestBuf) {
    throw new UnsupportedFileError("no AndroidManifest.xml entry found - not a recognizable APK");
  }
  const info = parseAndroidManifest(manifestBuf);
  return { platform: "android", ...info };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integration/parseApk.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/android/apk.ts tests/integration/parseApk.test.ts
git commit -m "feat: parseApk - Android public entry point"
```

---

## Task 7: Android v1 public API (phase 1 checkpoint)

**Files:**
- Create: `src/index.ts`
- Test: `tests/integration/index.test.ts`

**Interfaces:**
- Consumes: `parseApk`, `AndroidAppInfo` (Task 6), `UnsupportedFileError`, `ParseError` (Task 2).
- Produces: the package's public entry point — this is what `import ... from "app-binary-info"` resolves to.

This is the Phase 1 checkpoint: after this task, `app-binary-info` is a complete, independently useful, fully tested Android-only library. iOS support (Tasks 8–13) is additive from here.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/index.test.ts
import path from "path";
import { parseApk, UnsupportedFileError, ParseError } from "../../src/index";

test("the public entry point exports a working parseApk", async () => {
  const info = await parseApk(path.join(__dirname, "../fixtures/real/selendroid-test-app.apk"));
  expect(info.packageName).toBe("io.selendroid.testapp");
});

test("the public entry point exports both error classes", () => {
  expect(new UnsupportedFileError("x")).toBeInstanceOf(Error);
  expect(new ParseError("x")).toBeInstanceOf(Error);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/index.test.ts`
Expected: FAIL — cannot find module `../../src/index`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index.ts
export { parseApk, type AndroidAppInfo } from "./android/apk";
export { UnsupportedFileError, ParseError } from "./errors";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integration/index.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full test suite and build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: everything green; `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts` exist.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/integration/index.test.ts
git commit -m "feat: public API v1 (Android-only) - parseApk, UnsupportedFileError, ParseError"
```

---

## Task 8: Binary plist parsing

**Files:**
- Create: `src/ios/bplist.ts`
- Test: `tests/unit/bplist.test.ts`

**Interfaces:**
- Consumes: `ParseError` from `src/errors.ts`.
- Produces: `isBinaryPlist(buf: Buffer): boolean`, `readBinaryPlistStrings(buf: Buffer, keys: string[]): Record<string, string>` — Task 10 (`ios/plist.ts`) depends on both exact names.

**Design note:** `readBinaryPlistStrings` reads *only* the requested keys out of the top-level dict — it never attempts to resolve every value in the dict. A real Xcode-produced `Info.plist` has many keys of types this project has no reason to parse (arrays, booleans, nested dicts); eagerly resolving the whole tree would throw on the first one of those. Only key objects (always strings) and the specific requested values are ever read.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/bplist.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/bplist.test.ts`
Expected: FAIL — cannot find module `../../src/ios/bplist`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ios/bplist.ts
import { ParseError } from "../errors";

const MAGIC = "bplist00";
const TRAILER_SIZE = 32;

export function isBinaryPlist(buf: Buffer): boolean {
  return buf.length >= 8 && buf.toString("ascii", 0, 8) === MAGIC;
}

function readUInt(buf: Buffer, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + buf.readUInt8(offset + i);
  return value;
}

function readCount(buf: Buffer, offset: number, lowNibble: number): { count: number; headerLen: number } {
  if (lowNibble !== 0x0f) return { count: lowNibble, headerLen: 1 };
  // Extended: the next byte is an int-type marker whose own value is the real count.
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
  const marker = buf.readUInt8(offset);
  const highNibble = marker >> 4;
  const lowNibble = marker & 0x0f;
  const { count, headerLen } = readCount(buf, offset, lowNibble);
  const start = offset + headerLen;
  if (highNibble === 0x5) return buf.toString("ascii", start, start + count);
  if (highNibble === 0x6) return decodeUtf16Be(buf, start, count);
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

  const objectOffsets: number[] = [];
  for (let i = 0; i < numObjects; i++) {
    objectOffsets.push(readUInt(buf, offsetTableOffset + i * offsetIntSize, offsetIntSize));
  }

  const rootOffset = objectOffsets[topObjectIndex];
  const rootMarker = buf.readUInt8(rootOffset);
  if (rootMarker >> 4 !== 0xd) {
    throw new ParseError("binary plist's top-level object is not a dictionary");
  }
  const { count, headerLen } = readCount(buf, rootOffset, rootMarker & 0x0f);
  const refsStart = rootOffset + headerLen;

  const result: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const keyRef = readUInt(buf, refsStart + i * objectRefSize, objectRefSize);
    const key = readStringObject(buf, objectOffsets[keyRef]);
    if (!keys.includes(key)) continue;
    const valueRef = readUInt(buf, refsStart + count * objectRefSize + i * objectRefSize, objectRefSize);
    result[key] = readStringObject(buf, objectOffsets[valueRef]);
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/bplist.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ios/bplist.ts tests/unit/bplist.test.ts
git commit -m "feat: binary plist parsing (readBinaryPlistStrings)"
```

---

## Task 9: XML plist parsing

**Files:**
- Create: `src/ios/xmlplist.ts`
- Test: `tests/unit/xmlplist.test.ts`

**Interfaces:**
- Produces: `readXmlPlistStrings(xml: string, keys: string[]): Record<string, string>` — Task 10 depends on this exact name.

**Design note:** deliberately not a general XML parser — a small pattern reader for top-level `<key>…</key><string>…</string>` pairs only, matching the design spec's scope (D-3). A key name that legitimately recurs nested inside a sub-dict is a known, accepted limitation, not a bug to fix here.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/xmlplist.test.ts
import fs from "fs";
import path from "path";
import { readXmlPlistStrings } from "../../src/ios/xmlplist";

const REAL_XML_PLIST = path.join(__dirname, "../fixtures/real/Info.plist");

test("reads the requested keys from a real XML plist", () => {
  const xml = fs.readFileSync(REAL_XML_PLIST, "utf8");
  const values = readXmlPlistStrings(xml, ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"]);
  expect(values).toEqual({
    CFBundleIdentifier: "com.example.SampleApp",
    CFBundleShortVersionString: "1.2.3",
    CFBundleVersion: "42",
  });
});

test("ignores keys not requested", () => {
  const xml = fs.readFileSync(REAL_XML_PLIST, "utf8");
  const values = readXmlPlistStrings(xml, ["CFBundleIdentifier"]);
  expect(values).toEqual({ CFBundleIdentifier: "com.example.SampleApp" });
});

test("returns an empty object when nothing matches", () => {
  const xml = fs.readFileSync(REAL_XML_PLIST, "utf8");
  expect(readXmlPlistStrings(xml, ["NotAKey"])).toEqual({});
});

test("decodes XML entities in values", () => {
  const xml = `<plist><dict><key>Name</key><string>Tom &amp; Jerry &lt;3&gt;</string></dict></plist>`;
  expect(readXmlPlistStrings(xml, ["Name"])).toEqual({ Name: "Tom & Jerry <3>" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/xmlplist.test.ts`
Expected: FAIL — cannot find module `../../src/ios/xmlplist`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ios/xmlplist.ts

/**
 * Reads only top-level <key>NAME</key><string>VALUE</string> pairs out of
 * an XML plist - not a general XML parser. See this file's usage note in
 * the implementation plan for why that's the deliberate scope.
 */
export function readXmlPlistStrings(xml: string, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /<key>\s*([^<]+?)\s*<\/key>\s*<string>([\s\S]*?)<\/string>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const [, key, value] = match;
    if (keys.includes(key)) {
      result[key] = decodeXmlEntities(value);
    }
  }
  return result;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/xmlplist.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ios/xmlplist.ts tests/unit/xmlplist.test.ts
git commit -m "feat: XML plist parsing (readXmlPlistStrings)"
```

---

## Task 10: plist dispatcher + parseIpa

**Files:**
- Create: `src/ios/plist.ts`
- Create: `src/ios/ipa.ts`
- Test: `tests/integration/parseIpa.test.ts`

**Interfaces:**
- Consumes: `readBinaryPlistStrings`, `isBinaryPlist` (Task 8), `readXmlPlistStrings` (Task 9), `readZipEntry`, `findZipEntryName` (Task 3), `UnsupportedFileError`, `ParseError` (Task 2).
- Produces: `IosAppInfo { platform: "ios"; bundleId: string; versionName?: string; buildNumber?: string }`, `parseIpa(input: string | Buffer): Promise<IosAppInfo>` — Task 11 and `index.ts` (Task 12) depend on this exact export.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/parseIpa.test.ts
import path from "path";
import fs from "fs";
import { parseIpa } from "../../src/ios/ipa";
import { UnsupportedFileError } from "../../src/errors";

const IPA_FIXTURE = path.join(__dirname, "../fixtures/real/sample.ipa");

test("parses a real IPA (binary plist Info.plist) from a file path", async () => {
  const info = await parseIpa(IPA_FIXTURE);
  expect(info).toEqual({
    platform: "ios",
    bundleId: "com.example.SampleApp",
    versionName: "1.2.3",
    buildNumber: "42",
  });
});

test("parses the same real IPA from a Buffer", async () => {
  const buf = fs.readFileSync(IPA_FIXTURE);
  const info = await parseIpa(buf);
  expect(info.bundleId).toBe("com.example.SampleApp");
});

test("a zip with no Payload/*.app/Info.plist throws UnsupportedFileError", async () => {
  const apkFixture = path.join(__dirname, "../fixtures/real/selendroid-test-app.apk"); // a real zip, but not an IPA
  await expect(parseIpa(apkFixture)).rejects.toThrow(UnsupportedFileError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/parseIpa.test.ts`
Expected: FAIL — cannot find module `../../src/ios/ipa`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ios/plist.ts
import { readBinaryPlistStrings, isBinaryPlist } from "./bplist";
import { readXmlPlistStrings } from "./xmlplist";

/** Reads named string keys out of an Info.plist buffer, whichever of the
 * two plist forms it turns out to be. */
export function readPlistStrings(buf: Buffer, keys: string[]): Record<string, string> {
  if (isBinaryPlist(buf)) {
    return readBinaryPlistStrings(buf, keys);
  }
  return readXmlPlistStrings(buf.toString("utf8"), keys);
}
```

```ts
// src/ios/ipa.ts
import { readZipEntry, findZipEntryName } from "../zip";
import { readPlistStrings } from "./plist";
import { UnsupportedFileError, ParseError } from "../errors";

export interface IosAppInfo {
  platform: "ios";
  bundleId: string;
  versionName?: string;
  buildNumber?: string;
}

const INFO_PLIST_PATTERN = /^Payload\/[^/]+\.app\/Info\.plist$/;

export async function parseIpa(input: string | Buffer): Promise<IosAppInfo> {
  const entryName = await findZipEntryName(input, (name) => INFO_PLIST_PATTERN.test(name));
  if (!entryName) {
    throw new UnsupportedFileError("no Payload/*.app/Info.plist entry found - not a recognizable IPA");
  }
  const plistBuf = await readZipEntry(input, entryName);
  if (!plistBuf) {
    throw new ParseError(`found ${entryName} in the zip's directory but could not read its contents`);
  }
  const values = readPlistStrings(plistBuf, ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"]);
  if (!values.CFBundleIdentifier) {
    throw new ParseError(`${entryName} has no CFBundleIdentifier`);
  }
  return {
    platform: "ios",
    bundleId: values.CFBundleIdentifier,
    versionName: values.CFBundleShortVersionString,
    buildNumber: values.CFBundleVersion,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integration/parseIpa.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ios/plist.ts src/ios/ipa.ts tests/integration/parseIpa.test.ts
git commit -m "feat: parseIpa - iOS public entry point"
```

---

## Task 11: Unified auto-detecting parse()

**Files:**
- Create: `src/detect.ts`
- Test: `tests/integration/detect.test.ts`

**Interfaces:**
- Consumes: `listZipEntryNames` (Task 3), `parseApk`, `AndroidAppInfo` (Task 6), `parseIpa`, `IosAppInfo` (Task 10), `UnsupportedFileError` (Task 2).
- Produces: `AppInfo = AndroidAppInfo | IosAppInfo`, `parse(input: string | Buffer): Promise<AppInfo>` — `index.ts` (Task 12) depends on this exact export.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/detect.test.ts
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { parse } from "../../src/detect";
import { UnsupportedFileError } from "../../src/errors";

test("auto-detects and parses an APK", async () => {
  const info = await parse(path.join(__dirname, "../fixtures/real/selendroid-test-app.apk"));
  expect(info.platform).toBe("android");
  if (info.platform === "android") {
    expect(info.packageName).toBe("io.selendroid.testapp");
  }
});

test("auto-detects and parses an IPA", async () => {
  const info = await parse(path.join(__dirname, "../fixtures/real/sample.ipa"));
  expect(info.platform).toBe("ios");
  if (info.platform === "ios") {
    expect(info.bundleId).toBe("com.example.SampleApp");
  }
});

test("throws UnsupportedFileError for a zip that's neither", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-binary-info-test-"));
  fs.writeFileSync(path.join(dir, "readme.txt"), "hello");
  const zipPath = path.join(dir, "plain.zip");
  execFileSync("zip", ["-q", zipPath, "readme.txt"], { cwd: dir });
  await expect(parse(zipPath)).rejects.toThrow(UnsupportedFileError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/detect.test.ts`
Expected: FAIL — cannot find module `../../src/detect`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect.ts
import { listZipEntryNames } from "./zip";
import { parseApk, type AndroidAppInfo } from "./android/apk";
import { parseIpa, type IosAppInfo } from "./ios/ipa";
import { UnsupportedFileError } from "./errors";

export type AppInfo = AndroidAppInfo | IosAppInfo;

const INFO_PLIST_PATTERN = /^Payload\/[^/]+\.app\/Info\.plist$/;

export async function parse(input: string | Buffer): Promise<AppInfo> {
  const names = await listZipEntryNames(input);
  if (names.includes("AndroidManifest.xml")) {
    return parseApk(input);
  }
  if (names.some((n) => INFO_PLIST_PATTERN.test(n))) {
    return parseIpa(input);
  }
  throw new UnsupportedFileError(
    "not a recognizable APK or IPA (no AndroidManifest.xml or Payload/*.app/Info.plist entry)"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integration/detect.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/detect.ts tests/integration/detect.test.ts
git commit -m "feat: unified auto-detecting parse()"
```

---

## Task 12: Final public API + README examples

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/integration/index.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything from Tasks 6, 10, 11.
- Produces: the complete, final public API surface described in the design spec.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/index.test.ts - add these to the existing file
import path from "path";
import { parse, parseIpa, type IosAppInfo, type AppInfo } from "../../src/index";

test("the public entry point exports a working parseIpa", async () => {
  const info = await parseIpa(path.join(__dirname, "../fixtures/real/sample.ipa"));
  expect(info.bundleId).toBe("com.example.SampleApp");
});

test("the public entry point exports a working auto-detecting parse", async () => {
  const info = await parse(path.join(__dirname, "../fixtures/real/selendroid-test-app.apk"));
  expect(info.platform).toBe("android");
});

test("type-level: AppInfo is the discriminated union of both platforms", () => {
  const androidInfo: AppInfo = { platform: "android", packageName: "x" };
  const iosInfo: AppInfo = { platform: "ios", bundleId: "y" };
  expect(androidInfo.platform).toBe("android");
  expect(iosInfo.platform).toBe("ios");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/index.test.ts`
Expected: FAIL — `parseIpa`/`parse`/`AppInfo` not exported from `src/index`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index.ts - final version
export { parse, type AppInfo } from "./detect";
export { parseApk, type AndroidAppInfo } from "./android/apk";
export { parseIpa, type IosAppInfo } from "./ios/ipa";
export { UnsupportedFileError, ParseError } from "./errors";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integration/index.test.ts`
Expected: PASS (all 5 tests, including the 2 from Task 7)

- [ ] **Step 5: Update README.md's usage example to reflect the final API**

The README written in Task 1 already shows the final shape (`parse`, `parseApk`, `parseIpa`) - re-read it now and confirm it matches `src/index.ts` exactly. No changes expected; if the API drifted during implementation, fix the README to match reality, not the other way around.

- [ ] **Step 6: Run the full suite, typecheck, lint, and build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/integration/index.test.ts README.md
git commit -m "feat: final public API - parse, parseApk, parseIpa"
```

---

## Task 13: CI verification and first release tag

**Files:**
- None created — this task verifies what Task 1 already wrote.

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin docs/initial-design
gh pr create --title "Initial implementation" --body "Implements docs/superpowers/specs/2026-09-03-initial-design.md and docs/superpowers/plans/2026-09-03-app-binary-info.md."
```

- [ ] **Step 2: Watch the CI workflow run and confirm it passes**

Run: `gh pr checks --watch`
Expected: the `test` job (typecheck, lint, test, build) passes.

- [ ] **Step 3: Merge once green**

```bash
gh pr merge --squash
```

- [ ] **Step 4: Tag the first release**

```bash
git checkout main
git pull
git tag v0.1.0
git push origin v0.1.0
```

- [ ] **Step 5: Confirm the release workflow ran (it will fail at the publish step without `NPM_TOKEN` — that's expected and fine for now)**

Run: `gh run list --workflow=release.yml`

If an `NPM_TOKEN` repository secret exists, expect a full pass and the package live on npm. If not (the expected case per this plan's Global Constraints — no npm credentials existed when this plan was written), the build/test steps should still pass; only the final `npm publish` step fails, and publishing becomes a manual follow-up once a token is added as a repository secret.
