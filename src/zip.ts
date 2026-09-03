import yauzl, { type Entry, type ZipFile } from "yauzl";
import { UnsupportedFileError } from "./errors";

function openZip(input: string | Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, zipfile?: ZipFile) => {
      if (err || !zipfile) {
        reject(new UnsupportedFileError(`not a valid zip file: ${err?.message ?? "unknown error"}`));
        return;
      }
      resolve(zipfile);
    };
    if (typeof input === "string") {
      yauzl.open(input, { lazyEntries: true }, cb);
    } else {
      yauzl.fromBuffer(input, { lazyEntries: true }, cb);
    }
  });
}

function readEntryStream(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new UnsupportedFileError(`failed to open zip entry: ${err?.message ?? "unknown error"}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", (streamErr: Error) => {
        reject(new UnsupportedFileError(`failed to read zip entry: ${streamErr.message}`));
      });
    });
  });
}

/** Lists every entry name in the zip, in central-directory order. */
export function listZipEntryNames(input: string | Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    openZip(input).then((zipfile) => {
      const names: string[] = [];
      zipfile.on("entry", (entry: Entry) => {
        names.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve(names));
      zipfile.on("error", (err: Error) => {
        reject(new UnsupportedFileError(`corrupted zip file: ${err.message}`));
      });
      zipfile.readEntry();
    }, reject);
  });
}

/** Reads one named entry's full contents, or undefined if no entry has that exact name. */
export function readZipEntry(input: string | Buffer, entryName: string): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    openZip(input).then((zipfile) => {
      let found = false;
      zipfile.on("entry", (entry: Entry) => {
        if (entry.fileName === entryName) {
          found = true;
          readEntryStream(zipfile, entry).then((buf) => {
            zipfile.close();
            resolve(buf);
          }, (err) => {
            zipfile.close();
            reject(err);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on("end", () => {
        if (!found) resolve(undefined);
      });
      zipfile.on("error", (err: Error) => {
        reject(new UnsupportedFileError(`corrupted zip file: ${err.message}`));
      });
      zipfile.readEntry();
    }, reject);
  });
}

/** Finds the first entry name matching a predicate, or undefined. */
export function findZipEntryName(
  input: string | Buffer,
  predicate: (name: string) => boolean
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    openZip(input).then((zipfile) => {
      let found: string | undefined;
      zipfile.on("entry", (entry: Entry) => {
        if (found === undefined && predicate(entry.fileName)) {
          found = entry.fileName;
        }
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve(found));
      zipfile.on("error", (err: Error) => {
        reject(new UnsupportedFileError(`corrupted zip file: ${err.message}`));
      });
      zipfile.readEntry();
    }, reject);
  });
}
