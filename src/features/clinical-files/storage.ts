import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp|pdf|dcm)$/i;

export type DetectedClinicalFile = {
  kind: "image" | "document";
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "application/dicom";
  extension: "jpg" | "png" | "webp" | "pdf" | "dcm";
};

export function detectClinicalFile(bytes: Uint8Array): DetectedClinicalFile | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) {
    return { kind: "image", mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP") {
    return { kind: "image", mimeType: "image/webp", extension: "webp" };
  }
  if (bytes.length >= 5 && new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-") {
    return { kind: "document", mimeType: "application/pdf", extension: "pdf" };
  }
  if (bytes.length >= 132 && new TextDecoder("ascii").decode(bytes.slice(128, 132)) === "DICM") {
    return { kind: "document", mimeType: "application/dicom", extension: "dcm" };
  }
  return null;
}

// Runtime data, not code: turbopackIgnore keeps the bundler from tracing (and shipping) the project or the
// stored patient files into the standalone server output.
function storageRoot() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.CLINICAL_STORAGE_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "clinical-files"));
}

function absolutePath(storageKey: string) {
  if (!STORAGE_KEY.test(storageKey)) throw new Error("invalidStorageKey");
  const root = storageRoot();
  const target = path.resolve(/*turbopackIgnore: true*/ root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("invalidStorageKey");
  return target;
}

export async function storeClinicalFile(storageKey: string, bytes: Uint8Array) {
  const target = absolutePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}

export async function loadClinicalFile(storageKey: string) {
  return readFile(absolutePath(storageKey));
}

/** Rollback only: product workflows never delete an accepted clinical file. */
export async function rollbackClinicalFile(storageKey: string) {
  try { await unlink(absolutePath(storageKey)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
