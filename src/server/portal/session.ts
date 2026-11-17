import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db/client";
import { patientSessions } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import type { PatientIdentity } from "./auth";

export const PATIENT_SESSION_COOKIE = "cdp_patient_session";
const TTL = 12 * 60 * 60 * 1000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type PatientPortalContext = PatientIdentity & { sessionId: string };

export async function createPatientSession(identity: PatientIdentity) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL);
  await withDbContext({ actorType: "patient", networkPatientId: identity.networkPatientId }, (tx) =>
    tx.insert(patientSessions).values({ id: hash(token), accountId: identity.accountId, networkPatientId: identity.networkPatientId, expiresAt }));
  (await cookies()).set(PATIENT_SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/portal", expires: expiresAt,
  });
}

export const readPatientSession = cache(async (): Promise<PatientPortalContext | null> => {
  const token = (await cookies()).get(PATIENT_SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db.execute<{ session_id: string; account_id: string; network_patient_id: string; email: string; locale: string; expires_at: Date }>(
    sql`select * from app_private.patient_session_lookup(${hash(token)})`,
  );
  const row = rows[0];
  if (!row) return null;
  return { sessionId: row.session_id, accountId: row.account_id, networkPatientId: row.network_patient_id, email: row.email, locale: row.locale };
});

export async function requirePatientSession() {
  const session = await readPatientSession();
  if (!session) redirect("/portal/login");
  return session;
}

export async function revokePatientSession() {
  const store = await cookies();
  const token = store.get(PATIENT_SESSION_COOKIE)?.value;
  if (token) {
    const session = await readPatientSession();
    if (session) await withDbContext({ actorType: "patient", networkPatientId: session.networkPatientId }, (tx) =>
      tx.update(patientSessions).set({ revokedAt: new Date() }).where(eq(patientSessions.id, hash(token))));
  }
  store.delete(PATIENT_SESSION_COOKIE);
}
