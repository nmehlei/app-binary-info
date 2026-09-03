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
