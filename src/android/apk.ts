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
