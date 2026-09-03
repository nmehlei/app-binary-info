import { readBinaryPlistStrings, isBinaryPlist } from "./bplist";
import { readXmlPlistStrings } from "./xmlplist";

/** Reads named string keys out of an Info.plist buffer, whichever of the
 * two plist forms it turns out to be. */
export function readPlistStrings(buf: Buffer, keys: string[]): Record<string, string> {
  if (isBinaryPlist(buf)) {
    return readBinaryPlistStrings(buf, keys);
  }
  return readXmlPlistStrings(buf.toString("utf8"), keys);
}
