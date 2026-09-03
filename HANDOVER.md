# Handover — working on this repo

Context for picking this up in a fresh session. `README.md` covers the API;
this covers how it's built, released, and consumed, plus the traps that cost
time getting here.

## What this is

A hand-rolled, dependency-light (only `yauzl`, for zip reading) parser that
reads an app's real identity — package/bundle id, version name, version
code/build number — straight out of its own built binary (Android APK,
iOS IPA). No `aapt`/Xcode toolchain, no config value that can drift from
what's actually in the binary.

It was built during [[MobileDeviceFarm]]'s 2026-09-03
`derive-app-id-from-apk` cycle, when a deployment-wide `APP_ID` config value
broke as soon as a second consumer org started uploading a different app.
Rather than depend on an existing, largely unmaintained npm package for APK
manifest parsing, it was built from scratch, spec'd, planned, reviewed, and
published as its own open-source project — genuinely reusable outside
MobileDeviceFarm, not just extracted for tidiness.

**Design spec:** `docs/superpowers/specs/2026-09-03-initial-design.md`
**Plan (has the exact byte-format details for every parser):**
`docs/superpowers/plans/2026-09-03-app-binary-info.md`

## Consumers

- **MobileDeviceFarm** (`src/appId.ts`) — the only consumer today. Treats
  the parsed package name as **untrusted input**: it's shape-validated
  there before being used, because MobileDeviceFarm forwards it into
  `adb shell` commands. This package itself does no such validation — it
  reports whatever the manifest says, faithfully. Callers that feed the
  result into something shell-adjacent need their own validation, the way
  MobileDeviceFarm does.

## Format notes (byte-level, if you're touching a parser)

- **Android**: `AndroidManifest.xml` inside the APK's zip is **Android
  Binary XML (AXML)**, not text XML — a custom binary chunk format (chunk
  header: `u16 type, u16 headerSize, u32 size`, all little-endian; a string
  pool with a UTF-8/UTF-16 flag; `ResXMLTree_node`/`attrExt` structs). See
  `src/android/axml.ts`. Every offset in there was verified against a real
  hexdump of a downloaded APK during the original build, not just written
  from a spec — if a manifest ever fails to parse, re-verify byte offsets
  against a real hexdump before assuming the fixture/test is wrong.
- **iOS**: `Info.plist` inside the IPA can be **either** a binary plist
  (`bplist00` magic, object table + offset table + 32-byte trailer) or an
  XML plist — `src/ios/plist.ts` detects which and dispatches to
  `src/ios/bplist.ts` or `src/ios/xmlplist.ts`. The binary-plist reader
  (`readBinaryPlistStrings`) is deliberately lazy — it only resolves the
  specific keys the caller asks for, not the whole object table — that's a
  load-bearing design choice (verified by code trace during review, not
  just assumed), not an accident.
- **Test fixtures are real files, never fabricated.** The Android fixtures
  came from Appium's `sample-apps` repo (Apache-2.0):
  `selendroid-test-app.apk` → `io.selendroid.testapp`,
  `ContactManager.apk` → `com.example.android.contactmanager`. The iOS
  plist fixtures were generated with the real `plutil` tool. Every fixture
  was independently verified (hexdump, or the parser itself once it
  existed) before being trusted in a test — don't add a fixture you
  haven't verified the same way.

## Release process

Tag-triggered, not branch-triggered:

```
git tag vX.Y.Z && git push origin vX.Y.Z
```

`GitVersion.yml` (Mainline mode) is the authority for deciding what the
*next* version should be — run `dotnet-gitversion` locally on `main` before
tagging, where GitVersion can actually see a branch. **Do not expect CI to
recompute the version** — `.github/workflows/release.yml` derives it
straight from `$GITHUB_REF_NAME` (the pushed tag), not by re-running
GitVersion. That's deliberate, not a shortcut:

> A tag-triggered checkout is detached HEAD (`BranchName: "(no branch)"`),
> which matches none of `GitVersion.yml`'s branch config and falls back to
> an "unknown branch" prerelease scheme — e.g. tag `v0.1.1` would publish as
> `0.1.2-tags-v0-1-1.1` instead of `0.1.1`. Deriving from the tag itself is
> correct by construction: whatever was tagged is exactly what gets
> published, with no re-derivation step to drift. (Discovered the hard way,
> confirmed by reproducing locally: `git checkout v0.1.1 --detach &&
> dotnet-gitversion`.)

`release.yml` then runs typecheck + full test suite + build **before**
`npm publish --access public` — a tag that fails any of those never
reaches npm.

## Traps that cost real time

- **`NPM_TOKEN` needs "bypass 2FA" explicitly enabled** on the npm Granular
  Access Token, or `npm publish` fails with a `403` in CI (unattended
  publishing can't satisfy an interactive 2FA prompt). Token scope should
  be "All packages" — needed for a not-yet-published package name.
- **`tsconfig.json`'s `include` covers only `src/`.** `npx tsc --noEmit`
  structurally can never show a type error in a test file — only
  `ts-jest` (i.e. actually running `npx jest <file>`) surfaces those.
  Don't trust a clean `tsc --noEmit` as proof the tests typecheck.

## Current state

Published: `app-binary-info@0.1.2` on npm, MIT licensed, public GitHub repo
`nmehlei/app-binary-info`. CI (`ci.yml`) runs on every PR and push to
`main`: typecheck, lint, test, build. No known open issues at time of
writing — the only planned consumer (MobileDeviceFarm) has it fully wired
in and merged (MobileDeviceFarm PR #391).
