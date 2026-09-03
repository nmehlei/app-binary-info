import fs from "fs";
import path from "path";
import { readXmlPlistStrings } from "../../src/ios/xmlplist";

const REAL_XML_PLIST = path.join(__dirname, "../fixtures/real/Info.plist");

test("reads the requested keys from a real XML plist", () => {
  const xml = fs.readFileSync(REAL_XML_PLIST, "utf8");
  const values = readXmlPlistStrings(xml, ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"]);
  expect(values).toEqual({
    CFBundleIdentifier: "com.example.SampleApp",
    CFBundleShortVersionString: "1.2.3",
    CFBundleVersion: "42",
  });
});

test("ignores keys not requested", () => {
  const xml = fs.readFileSync(REAL_XML_PLIST, "utf8");
  const values = readXmlPlistStrings(xml, ["CFBundleIdentifier"]);
  expect(values).toEqual({ CFBundleIdentifier: "com.example.SampleApp" });
});

test("returns an empty object when nothing matches", () => {
  const xml = fs.readFileSync(REAL_XML_PLIST, "utf8");
  expect(readXmlPlistStrings(xml, ["NotAKey"])).toEqual({});
});

test("decodes XML entities in values", () => {
  const xml = `<plist><dict><key>Name</key><string>Tom &amp; Jerry &lt;3&gt;</string></dict></plist>`;
  expect(readXmlPlistStrings(xml, ["Name"])).toEqual({ Name: "Tom & Jerry <3>" });
});
