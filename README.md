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
