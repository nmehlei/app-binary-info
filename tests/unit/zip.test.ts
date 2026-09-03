import path from "path";
import { readZipEntry, findZipEntryName, listZipEntryNames } from "../../src/zip";
import { UnsupportedFileError } from "../../src/errors";

const APK_FIXTURE = path.join(__dirname, "../fixtures/real/selendroid-test-app.apk");

test("listZipEntryNames lists every entry including AndroidManifest.xml", async () => {
  const names = await listZipEntryNames(APK_FIXTURE);
  expect(names).toContain("AndroidManifest.xml");
  expect(names.length).toBeGreaterThan(1);
});

test("readZipEntry reads a named entry's contents", async () => {
  const buf = await readZipEntry(APK_FIXTURE, "AndroidManifest.xml");
  expect(buf).toBeInstanceOf(Buffer);
  expect(buf!.length).toBeGreaterThan(0);
});

test("readZipEntry returns undefined for a name that doesn't exist", async () => {
  const buf = await readZipEntry(APK_FIXTURE, "does/not/exist.xml");
  expect(buf).toBeUndefined();
});

test("findZipEntryName returns the first entry matching a predicate", async () => {
  const name = await findZipEntryName(APK_FIXTURE, (n) => n.endsWith(".xml"));
  expect(name).toBe("res/layout/homescreen.xml");
});

test("findZipEntryName returns undefined when nothing matches", async () => {
  const name = await findZipEntryName(APK_FIXTURE, (n) => n.endsWith(".doesnotexist"));
  expect(name).toBeUndefined();
});

test("works from a Buffer, not just a file path", async () => {
  const fs = require("fs");
  const buf = fs.readFileSync(APK_FIXTURE);
  const names = await listZipEntryNames(buf);
  expect(names).toContain("AndroidManifest.xml");
});

test("a non-zip input throws UnsupportedFileError", async () => {
  await expect(listZipEntryNames(Buffer.from("not a zip file at all"))).rejects.toThrow(UnsupportedFileError);
});
