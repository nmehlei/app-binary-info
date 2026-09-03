# app-binary-info — design

## Why

Extracting an app's identity (Android package name; iOS bundle id) from its
own built binary — rather than trusting a separately-maintained config value
that can drift from what was actually built — needs a small, dependency-light
parser. The npm ecosystem for this is thin: every existing option is either
unmaintained (`app-info-parser`, last published Jan 2024, six dependencies
half of which exist only for the iOS side; `apk-parser`/`apk-parser2`, 2022,
and `apk-parser` shells out to `aapt` internally, defeating the point;
`node-apk-parser`, 2023, pinned to `adm-zip@~0.4.4`; `manifest-extractor`,
2022) or thin (`apk-manifest-parser`, 2023, one healthy dependency but the
package itself hasn't been touched since). None of them are something a
production service should take a runtime dependency on without reservation.

This project exists to be that dependency-light option, generally reusable
rather than tied to any one consumer.

## Scope

**In scope (v1):**
- Parse an Android `.apk`: package name, version name, version code.
- Parse an iOS `.ipa`: bundle id, version name (`CFBundleShortVersionString`),
  build number (`CFBundleVersion`).
- Both binary-plist (`bplist00`) and XML plist forms of `Info.plist`.
- A single auto-detecting `parse()` entry point, plus explicit
  `parseApk()`/`parseIpa()` for a caller that already knows its format.

**Explicitly out of scope (v1):**
- App icons, permissions, activities/intents, entitlements, or any manifest
  data beyond identity + version.
- Writing/modifying a manifest or plist — read-only.
- Signing-certificate inspection.
- A CLI. Library only; a wrapper CLI is a trivial, separable addition later
  if ever wanted.

## Decisions

### D-1 — Zip container reading takes a dependency; manifest/plist parsing does not

The problem this project solves is specifically "don't depend on an
unmaintained wrapper for the differentiating, format-specific parsing." Zip
container reading is a commodity, solved problem with an excellent maintained
library (`yauzl` — stream-based, minimal, stable for a decade) and is not
where any of the surveyed alternatives were actually weak. Taking this one
dependency, while hand-rolling the two format-specific parsers, is a
deliberate line, not an inconsistency.

**Rejected:** hand-rolling zip reading too. Zip's central-directory format is
itself non-trivial (multiple compression methods, ZIP64, data descriptors),
and getting it wrong buys nothing — it isn't the differentiating hard part,
and a bug there resembles a bug in a hundred other tools' zip handling rather
than being specific to this project's mission.

### D-2 — AXML (Android Binary XML) parsed directly, targeting only what's needed

`AndroidManifest.xml` inside an APK is compiled to a binary chunk format
(AOSP's `ResourceTypes.h`), not text — stable and undocumented-but-reverse-
engineered for over a decade, with prior art in tools like `apktool` and
`android-chunk-utils` confirming the chunk layout. The parser reads:

1. The string pool chunk (`RES_STRING_POOL_TYPE`) — handles both UTF-8 and
   UTF-16 encoded pools (a flag in the pool header selects which).
2. The first `RES_XML_START_ELEMENT_TYPE` chunk naming the `manifest` tag,
   reading its attribute list for `package` (a raw string reference — no
   `android:` namespace) and, if present, `android:versionCode` (int) and
   `android:versionName` (string reference).

It does not build a full DOM or walk the whole tree — the manifest root
tag's attributes are always the first `START_TAG` in a well-formed manifest,
so the parser can stop as soon as it's found.

### D-3 — Binary plist parsed directly; XML plist gets a minimal dedicated reader, not a general XML parser

`Info.plist` is binary (`bplist00` magic) in most real IPAs, but XML plists
still occur (some build tools, and any Info.plist someone re-saved from
Xcode's plist editor in XML mode). Handling only one form would leave a
plausible real-world file unparseable.

- **Binary plist**: Apple's format (documented via reverse-engineering,
  stable across OS versions) — trailer at EOF names the offset-table
  location and size; the offset table points into a typed object table
  (dict/array/string/int/real/date/data/uid). The parser walks just far
  enough to resolve the top-level dict's `CFBundleIdentifier`,
  `CFBundleShortVersionString`, and `CFBundleVersion` entries.
- **XML plist**: a small hand-rolled state-machine reader for top-level
  `<key>…</key><string>…</string>` pairs only — not a general XML parser.
  Real Info.plist files are simple enough (a flat or shallow dict of
  primitive values) that a general XML/DOM dependency would be solving a
  much bigger problem than this actually has.

### D-4 — `parse()` auto-detects; explicit functions exist for a caller that already knows

Detection is by contents, not filename extension: an APK and an IPA are both
zip files, distinguished by an `AndroidManifest.xml` entry
(APK) vs. a top-level `Payload/*.app/Info.plist` entry (IPA). A caller
passing a `.apk` path already knows it's Android, so `parseApk()`/`parseIpa()`
exist to skip detection and fail fast on the wrong format, rather than
silently accepting whatever `parse()` would have detected.

### D-5 — Errors distinguish "not a recognizable app binary" from "recognized but malformed"

`UnsupportedFileError` (not a zip at all, or a zip with neither manifest nor
Info.plist entry) vs. `ParseError` (found the right entry, but its chunk
structure doesn't parse — corrupt file, or a real format variant this parser
doesn't yet handle). A caller integrating this needs to tell "this isn't an
app binary" apart from "this might be a bug in the parser."

## Testing

Two layers, not one:

1. **Byte-level fixtures** — hand-constructed minimal chunk sequences
   (string pool + one `START_TAG`; a minimal bplist trailer + object table)
   exercising specific edge cases (UTF-8 vs. UTF-16 string pools, missing
   optional attributes, multiple string pool entries) without needing a real
   build tool to produce them.
2. **Real fixture files** — a couple of small, permissively-licensed sample
   `.apk`/`.ipa` files checked into `tests/fixtures/`, as an end-to-end check
   that the parser survives what a real build tool actually emits, not just
   what this project's own understanding of the format predicts.

Byte fixtures alone would only prove internal consistency with this
project's own model of the format; real fixtures are what catch "the actual
format has a wrinkle the reverse-engineered docs didn't mention."

## Tooling

- TypeScript, built with `tsup` to dual ESM+CJS + `.d.ts` — CJS output is a
  hard requirement, not a preference: MobileDeviceFarm (the first real
  consumer) compiles under `"module": "commonjs"`.
- Jest.
- GitHub Actions CI: typecheck + lint + test on every PR; a publish job
  gated on a version tag (requires an `NPM_TOKEN` repository secret, added
  out of band — no npm credentials exist in the environment this was
  designed in).
- Versioning: GitVersion 5.x, MainLine mode.

## Risks / Trade-offs

- **Hand-rolled binary parsing has real correctness risk** a maintained
  library wouldn't (endianness mistakes, wrong string-pool flag
  interpretation) → mitigated by the two-layer test strategy above, not
  eliminated. This is the honest cost of D-1/D-2/D-3's dependency-avoidance,
  stated plainly rather than glossed over.
- **iOS support roughly doubles v1's scope** versus Android-only (a second,
  unrelated binary format to parse and test correctly) for a feature whose
  first real consumer (MobileDeviceFarm) only needs Android today. Accepted
  deliberately for reuse value beyond that one consumer.
- **AXML/bplist format drift** — both are stable, multi-year-unchanged
  formats, but neither is contractually guaranteed never to change. A future
  Android/iOS version introducing a new chunk type or object type could
  require a parser update. No different in kind from any hand-rolled binary
  parser; noted as an ongoing maintenance cost of D-1's own trade-off.

## Out of scope for this spec

MobileDeviceFarm's own consumption of this package (replacing the per-org
`app_id` design from its own `openspec/changes/per-org-app-id/`) is a
separate change, in that repo, once this package has at least a working
`parseApk()`.
