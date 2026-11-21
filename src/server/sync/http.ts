// Shared checks for the cloud sync endpoints (/api/sync/*). Used only by route handlers.
import { NextResponse } from "next/server";
import { syncDatabaseConfigured, syncSql } from "./connection";
import { resolveNodeKey } from "./pairing";
import { SCHEMA_VERSION } from "./types";

export const SCHEMA_HEADER = "x-cabinet-schema";
const MAX_BODY_BYTES = 4_000_000;

export const syncJson = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });

/** Only the hosted copy answers, with the same database version as the clinic computer. */
export async function cloudGuard(request: Request): Promise<NextResponse | null> {
  if (!syncDatabaseConfigured()) return syncJson({ error: "syncDisabled" }, 503);
  const [row] = await syncSql()<{ role: string }[]>`select app_private.node_role() as role`;
  if (row?.role !== "cloud") return syncJson({ error: "notCloud" }, 404);
  if (request.headers.get(SCHEMA_HEADER) !== SCHEMA_VERSION) {
    return syncJson({ error: "schemaMismatch", schemaVersion: SCHEMA_VERSION }, 409);
  }
  return null;
}

/** The paired clinic computer, from its `Authorization: Bearer <node key>` header. */
export async function authenticatedNode(request: Request): Promise<{ organizationId: string } | NextResponse> {
  const denied = await cloudGuard(request);
  if (denied) return denied;
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const node = key ? await resolveNodeKey(syncSql(), key) : null;
  return node ? { organizationId: node.organizationId } : syncJson({ error: "unknownNode" }, 401);
}

export async function readSyncBody(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
