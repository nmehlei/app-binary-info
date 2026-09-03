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
