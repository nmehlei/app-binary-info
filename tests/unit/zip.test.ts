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

test("readZipEntry rejects with UnsupportedFileError when entry local header is corrupted", async () => {
  const fs = require("fs");
  const corruptedPath = path.join(__dirname, "../fixtures/real/corrupted-entry.apk");

  // corrupted-entry.apk has the first entry's local header corrupted but enumeration succeeds
  // Try to read the first entry - should fail with UnsupportedFileError
  const names = await listZipEntryNames(corruptedPath);
  expect(names.length).toBeGreaterThan(0);

  const firstEntry = names[0];
  // The first entry's local header is corrupted, so this should reject
  await expect(readZipEntry(corruptedPath, firstEntry)).rejects.toThrow(UnsupportedFileError);
});

test("readZipEntry succeeds on unaffected entries even when one entry is corrupted", async () => {
  const corruptedPath = path.join(__dirname, "../fixtures/real/corrupted-entry.apk");

  // Enumeration succeeds on corrupted-entry.apk
  const names = await listZipEntryNames(corruptedPath);
  expect(names.length).toBeGreaterThan(1);

  // The second entry (and others) should still be readable, proving corruption is localized
  const secondEntry = names[1];
  const data = await readZipEntry(corruptedPath, secondEntry);
  expect(data).toBeInstanceOf(Buffer);
  expect(data!.length).toBeGreaterThan(0);
});
