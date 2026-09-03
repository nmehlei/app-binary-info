import path from "path";
import { parseApk, UnsupportedFileError, ParseError } from "../../src/index";

test("the public entry point exports a working parseApk", async () => {
  const info = await parseApk(path.join(__dirname, "../fixtures/real/selendroid-test-app.apk"));
  expect(info.packageName).toBe("io.selendroid.testapp");
});

test("the public entry point exports both error classes", () => {
  expect(new UnsupportedFileError("x")).toBeInstanceOf(Error);
  expect(new ParseError("x")).toBeInstanceOf(Error);
});
