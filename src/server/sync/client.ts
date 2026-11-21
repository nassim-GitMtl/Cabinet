// Clinic computer -> cloud copy HTTP client. The clinic computer always opens the connection. No server-only imports.
import { SCHEMA_VERSION, type SyncChange, type SyncCursor } from "./types";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class SyncHttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

/** https only, except a local development address. Returns the origin, or null if unusable. */
export function normalizeCloudUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export type PairResponse = { organizationId: string; nodeKey: string; pullFrom: string; tables: string[] };
export type SnapshotResponse = { changes: SyncChange[]; after: string | null; done: boolean };
export type PullResponse = { changes: SyncChange[]; cursor: SyncCursor; more: boolean };

export function cloudClient(baseUrl: string, nodeKey: string | null, fetchImpl: FetchLike = fetch) {
  async function call<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cabinet-schema": SCHEMA_VERSION,
        ...(nodeKey ? { authorization: `Bearer ${nodeKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new SyncHttpError(response.status, data.error ?? `http${response.status}`);
    return data as T;
  }
  return {
    pair: (code: string) => call<PairResponse>("/api/sync/pair", { code }),
    snapshot: (table: string, after: string | null, waitFor: string) => call<SnapshotResponse>("/api/sync/snapshot", { table, after, waitFor }),
    push: (changes: SyncChange[]) => call<{ applied: number; skipped: number; pending: number }>("/api/sync/push", { changes }),
    pull: (cursor: SyncCursor) => call<PullResponse>("/api/sync/pull", { cursor }),
  };
}

/** Short, translatable reason for the status screen (never a stack trace or a secret). */
export function syncErrorCode(error: unknown): string {
  if (error instanceof SyncHttpError) {
    if (["schemaMismatch", "unknownNode", "pairingUnavailable", "syncDisabled", "notCloud"].includes(error.code)) return error.code;
    return error.status >= 500 ? "cloudUnavailable" : "rejected";
  }
  if (error instanceof TypeError || (error as { name?: string })?.name === "TimeoutError" || (error as { name?: string })?.name === "AbortError") return "offline";
  return "localError";
}
