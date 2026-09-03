/**
 * Reads only top-level <key>NAME</key><string>VALUE</string> pairs out of
 * an XML plist - not a general XML parser. See this file's usage note in
 * the implementation plan for why that's the deliberate scope.
 */
export function readXmlPlistStrings(xml: string, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /<key>\s*([^<]+?)\s*<\/key>\s*<string>([\s\S]*?)<\/string>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const [, key, value] = match;
    if (keys.includes(key)) {
      result[key] = decodeXmlEntities(value);
    }
  }
  return result;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
