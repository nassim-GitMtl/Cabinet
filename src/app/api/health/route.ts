import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

// Liveness + database check for Docker healthchecks and the in-app
// connection banner. Returns no data about clinics or patients.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
