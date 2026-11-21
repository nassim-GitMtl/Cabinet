import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobNotFoundError, del, get, put, rename } from "@vercel/blob";

const STORAGE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp|pdf|dcm)$/i;
const PENDING_BLOB_KEY = /^pending\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.bin$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function usesVercelBlobStorage() {
  return process.env.CLINICAL_STORAGE_BACKEND === "vercel-blob";
}

export function clinicalStorageConfigured() {
  const backend = process.env.CLINICAL_STORAGE_BACKEND;
  if (backend && backend !== "filesystem" && backend !== "vercel-blob") return false;
  // Vercel's filesystem is ephemeral. Refuse a seemingly healthy deployment
  // unless its durable private object store was selected explicitly.
  if (process.env.VERCEL && backend !== "vercel-blob") return false;
  return backend !== "vercel-blob" || Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function pendingClinicalBlobKey(patientId: string, uploadId: string) {
  if (!UUID.test(patientId) || !UUID.test(uploadId)) throw new Error("invalidStorageKey");
  return `pending/${patientId}/${uploadId}.bin`;
}

export function isPendingClinicalBlobKey(storageKey: string, patientId: string) {
  const match = PENDING_BLOB_KEY.exec(storageKey);
  return match?.[1]?.toLowerCase() === patientId.toLowerCase();
}

function missingStorageError() {
  const error = new Error("Clinical file is missing from private storage") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function assertReadableStorageKey(storageKey: string) {
  if (!STORAGE_KEY.test(storageKey) && !PENDING_BLOB_KEY.test(storageKey)) throw new Error("invalidStorageKey");
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
  if (usesVercelBlobStorage()) {
    if (!STORAGE_KEY.test(storageKey)) throw new Error("invalidStorageKey");
    const detected = detectClinicalFile(bytes);
    await put(storageKey, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: detected?.mimeType ?? "application/octet-stream",
    });
    return;
  }
  const target = absolutePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}

export async function loadClinicalFile(storageKey: string) {
  const opened = await openClinicalFile(storageKey);
  if (opened.body instanceof Uint8Array) return opened.body;
  return new Uint8Array(await new Response(opened.body).arrayBuffer());
}

export async function openClinicalFile(storageKey: string): Promise<{
  body: Uint8Array | ReadableStream<Uint8Array>;
  byteSize: number;
}> {
  if (usesVercelBlobStorage()) {
    assertReadableStorageKey(storageKey);
    const result = await get(storageKey, { access: "private", useCache: !PENDING_BLOB_KEY.test(storageKey) });
    if (!result || result.statusCode !== 200) throw missingStorageError();
    return { body: result.stream, byteSize: result.blob.size };
  }
  const bytes = new Uint8Array(await readFile(absolutePath(storageKey)));
  return { body: bytes, byteSize: bytes.length };
}

export async function finalizePendingClinicalBlob(
  pendingStorageKey: string,
  storageKey: string,
  mimeType: DetectedClinicalFile["mimeType"],
) {
  if (!usesVercelBlobStorage() || !PENDING_BLOB_KEY.test(pendingStorageKey) || !STORAGE_KEY.test(storageKey)) {
    throw new Error("invalidStorageKey");
  }
  await rename(pendingStorageKey, storageKey, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: mimeType,
  });
}

/** Rollback only: product workflows never delete an accepted clinical file. */
export async function rollbackClinicalFile(storageKey: string) {
  if (usesVercelBlobStorage()) {
    assertReadableStorageKey(storageKey);
    try { await del(storageKey); } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
    }
    return;
  }
  try { await unlink(absolutePath(storageKey)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
