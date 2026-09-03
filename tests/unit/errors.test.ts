import { UnsupportedFileError, ParseError } from "../../src/errors";

test("UnsupportedFileError is a real Error with the right name and message", () => {
  const err = new UnsupportedFileError("not a zip");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("UnsupportedFileError");
  expect(err.message).toBe("not a zip");
});

test("ParseError is a real Error with the right name and message", () => {
  const err = new ParseError("bad chunk");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("ParseError");
  expect(err.message).toBe("bad chunk");
});
