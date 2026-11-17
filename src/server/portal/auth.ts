import "server-only";
import { sql, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/server/auth/password";
import { db, type Database } from "@/server/db/client";
import { patientAccounts } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";

const MAX_FAILED = 5;
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-patient-password"));
const sha256 = async (value: string) => (await import("node:crypto")).createHash("sha256").update(value).digest("hex");

export type PatientIdentity = { accountId: string; networkPatientId: string; email: string; locale: string };

export async function getPortalInvitation(token: string, database: Database = db) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const rows = await database.execute<{ email: string; locale: string; clinic_name: string; expires_at: Date }>(
    sql`select * from app_private.resolve_portal_invitation(${await sha256(token)})`,
  );
  const row = rows[0];
  return row ? { email: row.email, locale: row.locale, clinicName: row.clinic_name, expiresAt: row.expires_at } : null;
}

export async function activatePortalAccount(token: string, password: string, database: Database = db): Promise<PatientIdentity> {
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);
  const passwordHash = await hashPassword(password);
  const tokenHash = await sha256(token);
  return database.transaction(async (tx) => {
    const rows = await tx.execute<{ account_id: string; network_patient_id: string; email: string; locale: string }>(
      sql`select * from app_private.activate_patient_portal(${tokenHash}, ${passwordHash})`,
    );
    const row = rows[0];
    if (!row) throw new Error("portalInviteUnavailable");
    await tx.execute(sql`select
      set_config('app.actor_type', 'patient', true),
      set_config('app.network_patient_id', ${row.network_patient_id}, true)`);
    await audit(tx, {
      organizationId: null,
      actorType: "patient",
      action: "patient_portal.activated",
      entityType: "patient_account",
      entityId: row.account_id,
    });
    return { accountId: row.account_id, networkPatientId: row.network_patient_id, email: row.email, locale: row.locale };
  });
}

export type PatientAuthResult = { ok: true; identity: PatientIdentity } | { ok: false; reason: "invalid" | "locked" | "disabled" };

export async function authenticatePatient(email: string, password: string, database: Database = db): Promise<PatientAuthResult> {
  const rows = await database.execute<{
    account_id: string; network_patient_id: string; email: string; password_hash: string; locale: string;
    status: "active" | "disabled"; failed_login_count: number; locked_until: Date | null;
  }>(sql`select * from app_private.patient_account_for_login(${email.trim()})`);
  const account = rows[0];
  if (!account) { await verifyPassword(password, await getDummyHash()); return { ok: false, reason: "invalid" }; }
  if (account.status !== "active") return { ok: false, reason: "disabled" };
  if (account.locked_until && new Date(account.locked_until) > new Date()) return { ok: false, reason: "locked" };
  const valid = await verifyPassword(password, account.password_hash);
  await withDbContext({ actorType: "patient", networkPatientId: account.network_patient_id }, async (tx) => {
    const failed = account.failed_login_count + 1;
    await tx.update(patientAccounts).set(valid ? {
      failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date(),
    } : {
      failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
      lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + 15 * 60_000) : account.locked_until,
      updatedAt: new Date(),
    }).where(eq(patientAccounts.id, account.account_id));
    await audit(tx, {
      organizationId: null, actorType: "patient", action: valid ? "patient_portal.login.succeeded" : "patient_portal.login.failed",
      entityType: "patient_account", entityId: account.account_id,
    });
  }, database);
  return valid ? { ok: true, identity: { accountId: account.account_id, networkPatientId: account.network_patient_id, email: account.email, locale: account.locale } } : { ok: false, reason: "invalid" };
}
