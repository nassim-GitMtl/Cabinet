import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { hashPassword, passwordPolicyError } from "@/server/auth/password";
import { db, type Database } from "@/server/db/client";
import { authenticate } from "@/server/services/auth";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type StaffInvitationInfo = { email: string; fullName: string; organizationName: string; expiresAt: Date; existingUser: boolean };

export async function getStaffInvitation(token: string, database: Database = db): Promise<StaffInvitationInfo | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const rows = await database.execute<{ email: string; full_name: string; organization_name: string; expires_at: Date; existing_user: boolean }>(sql`select * from app_private.resolve_staff_invitation(${hash(token)})`);
  const row = rows[0];
  return row ? { email: row.email, fullName: row.full_name, organizationName: row.organization_name, expiresAt: row.expires_at, existingUser: row.existing_user } : null;
}

export async function acceptStaffInvitation(token: string, password: string, database: Database = db) {
  const info = await getStaffInvitation(token, database);
  if (!info) throw new Error("invitationUnavailable");
  let passwordHash: string | null = null;
  if (info.existingUser) {
    const auth = await authenticate(info.email, password, null, database);
    if (!auth.ok) throw new Error("invalid");
  } else {
    const policy = passwordPolicyError(password);
    if (policy) throw new Error(policy);
    passwordHash = await hashPassword(password);
  }
  return database.transaction(async (tx) => {
    const rows = await tx.execute<{ user_id: string; organization_id: string }>(sql`select * from app_private.accept_staff_invitation(${hash(token)}, ${passwordHash})`);
    const row = rows[0];
    if (!row) throw new Error("invitationUnavailable");
    await tx.execute(sql`select set_config('app.org_id', ${row.organization_id}, true), set_config('app.user_id', ${row.user_id}, true), set_config('app.actor_type', 'staff', true)`);
    await audit(tx, { organizationId: row.organization_id, actorType: "staff", actorUserId: row.user_id, action: "staff.invitation_accepted", entityType: "membership" });
    return { userId: row.user_id, organizationId: row.organization_id };
  });
}
