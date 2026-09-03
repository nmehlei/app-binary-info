/** Thrown when the input isn't a recognizable app binary at all - not a
 * zip, or a zip with neither an AndroidManifest.xml nor a
 * Payload/*.app/Info.plist entry. */
export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFileError";
  }
}

/** Thrown when the right entry was found, but its contents don't parse -
 * corrupt file, or a real format variant this parser doesn't handle yet. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
