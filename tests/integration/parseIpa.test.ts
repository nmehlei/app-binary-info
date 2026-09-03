import path from "path";
import fs from "fs";
import os from "os";
import { execFileSync } from "child_process";
import { parseIpa } from "../../src/ios/ipa";
import { UnsupportedFileError } from "../../src/errors";

const IPA_FIXTURE = path.join(__dirname, "../fixtures/real/sample.ipa");
const XML_PLIST_FIXTURE = path.join(__dirname, "../fixtures/real/Info.plist");

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

test("parses a real IPA (XML plist Info.plist) built at test time", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-binary-info-test-"));
  const appDir = path.join(dir, "Payload", "SampleApp.app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.copyFileSync(XML_PLIST_FIXTURE, path.join(appDir, "Info.plist"));

  const ipaPath = path.join(dir, "sample-xml.ipa");
  execFileSync("zip", ["-q", "-r", ipaPath, "Payload"], { cwd: dir });

  const info = await parseIpa(ipaPath);
  expect(info).toEqual({
    platform: "ios",
    bundleId: "com.example.SampleApp",
    versionName: "1.2.3",
    buildNumber: "42",
  });
});
