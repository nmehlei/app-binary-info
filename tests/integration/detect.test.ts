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
