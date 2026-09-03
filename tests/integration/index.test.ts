import path from "path";
import { parse, parseApk, parseIpa, type AppInfo, UnsupportedFileError, ParseError } from "../../src/index";

test("the public entry point exports a working parseApk", async () => {
  const info = await parseApk(path.join(__dirname, "../fixtures/real/selendroid-test-app.apk"));
  expect(info.packageName).toBe("io.selendroid.testapp");
});

test("the public entry point exports both error classes", () => {
  expect(new UnsupportedFileError("x")).toBeInstanceOf(Error);
  expect(new ParseError("x")).toBeInstanceOf(Error);
});

test("the public entry point exports a working parseIpa", async () => {
  const info = await parseIpa(path.join(__dirname, "../fixtures/real/sample.ipa"));
  expect(info.bundleId).toBe("com.example.SampleApp");
});

test("the public entry point exports a working auto-detecting parse", async () => {
  const info = await parse(path.join(__dirname, "../fixtures/real/selendroid-test-app.apk"));
  expect(info.platform).toBe("android");
});

test("type-level: AppInfo is the discriminated union of both platforms", () => {
  const androidInfo: AppInfo = { platform: "android", packageName: "x" };
  const iosInfo: AppInfo = { platform: "ios", bundleId: "y" };
  expect(androidInfo.platform).toBe("android");
  expect(iosInfo.platform).toBe("ios");
});
