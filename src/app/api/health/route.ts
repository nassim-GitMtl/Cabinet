import { sql } from "drizzle-orm";
import { clinicalStorageConfigured } from "@/features/clinical-files/storage";
import { db } from "@/server/db/client";

// Liveness + database check for Docker healthchecks and the in-app
// connection banner. Returns no data about clinics or patients.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!clinicalStorageConfigured()) throw new Error("Clinical storage is not configured");
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
