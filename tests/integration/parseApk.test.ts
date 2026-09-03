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
