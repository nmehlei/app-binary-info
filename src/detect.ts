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
