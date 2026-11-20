import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { db, type Database } from "@/server/db/client";
import { memberships, organizations, roles, sessions, staffMfaChallenges, staffPasswordResets, users } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { hashPassword, passwordPolicyError, verifyPassword } from "./password";
import { consumeAuthRateLimit } from "./rate-limit";

/** Link handed over by an admin (in person, WhatsApp…): valid one day. */
export const ADMIN_RESET_HOURS = 24;
/** Link sent by email: one hour, at most three per account per hour. */
export const EMAIL_RESET_MINUTES = 60;
export const EMAIL_RESETS_PER_HOUR = 3;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export class PasswordResetError extends Error {
  constructor(public readonly code: "memberUnavailable" | "ownerProtected" | "selfProtected" | "accountShared") { super(code); }
}

/** Owner/admin creates a single-use link for one active colleague of this clinic. */
export async function createStaffPasswordReset(ctx: ClinicContext, membershipId: string, opts: { resetMfa: boolean }) {
  requirePermission(ctx, "org.staff.manage");
  return tenantTx(ctx, async (tx) => {
    const [member] = await tx.select({ userId: memberships.userId, status: memberships.status, roleKey: roles.key })
      .from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(eq(memberships.id, membershipId)).limit(1);
    if (!member || member.status !== "active") throw new PasswordResetError("memberUnavailable");
    if (member.userId === ctx.userId) throw new PasswordResetError("selfProtected");
    if (member.roleKey === "owner") throw new PasswordResetError("ownerProtected");
    const [scope] = await tx.execute<{ scope: string }>(sql`select app_private.staff_reset_scope(${member.userId}, ${ctx.organizationId}) as scope`);
    if (scope?.scope === "shared") throw new PasswordResetError("accountShared");
    if (scope?.scope !== "ok") throw new PasswordResetError("memberUnavailable");

    const token = newToken();
    const expiresAt = new Date(Date.now() + ADMIN_RESET_HOURS * 3_600_000);
    await tx.update(staffPasswordResets).set({ revokedAt: new Date() })
      .where(and(eq(staffPasswordResets.userId, member.userId), isNull(staffPasswordResets.usedAt), isNull(staffPasswordResets.revokedAt)));
    const [reset] = await tx.insert(staffPasswordResets).values({
      userId: member.userId, tokenHash: hash(token), channel: "admin_link", issuedByOrganizationId: ctx.organizationId,
      issuedByUserId: ctx.userId, resetMfa: opts.resetMfa, expiresAt,
    }).returning({ id: staffPasswordResets.id });
    await audit(tx, {
      organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "staff.password_reset_link_created",
      entityType: "membership", entityId: membershipId, metadata: { resetId: reset!.id, resetMfa: opts.resetMfa },
    });
    return { token, expiresAt };
  });
}

export type StaffPasswordResetInfo = { email: string; fullName: string; clinicName: string | null; resetMfa: boolean; expiresAt: Date };

async function openReset(token: string, database: Database) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const [row] = await database.select({ reset: staffPasswordResets, email: users.email, fullName: users.fullName, userStatus: users.status })
    .from(staffPasswordResets).innerJoin(users, eq(users.id, staffPasswordResets.userId))
    .where(and(eq(staffPasswordResets.tokenHash, hash(token)), isNull(staffPasswordResets.usedAt), isNull(staffPasswordResets.revokedAt), gt(staffPasswordResets.expiresAt, new Date())))
    .limit(1);
  return row && row.userStatus === "active" ? row : null;
}

/** What the reset page shows: whose account, which clinic issued it. Null when unknown, used, revoked or expired. */
export async function getStaffPasswordReset(token: string, database: Database = db): Promise<StaffPasswordResetInfo | null> {
  const row = await openReset(token, database);
  if (!row) return null;
  const orgId = row.reset.issuedByOrganizationId;
  const clinicName = orgId
    ? (await withDbContext({ organizationId: orgId, actorType: "system" }, (tx) => tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1), database))[0]?.name ?? null
    : null;
  return { email: row.email, fullName: row.fullName, clinicName, resetMfa: row.reset.resetMfa, expiresAt: row.reset.expiresAt };
}

/**
 * Sets the new password once: clears lockout, signs the account out everywhere, optionally turns off
 * two-step verification, and consumes the link (plus any other open link for the account).
 */
export async function resetStaffPassword(token: string, password: string, ipAddress: string | null = null, database: Database = db) {
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw new Error("resetUnavailable");
  const passwordHash = await hashPassword(password);
  return database.transaction(async (tx) => {
    const [reset] = await tx.select().from(staffPasswordResets)
      .where(and(eq(staffPasswordResets.tokenHash, hash(token)), isNull(staffPasswordResets.usedAt), isNull(staffPasswordResets.revokedAt), gt(staffPasswordResets.expiresAt, new Date())))
      .for("update").limit(1);
    if (!reset) throw new Error("resetUnavailable");
    const [user] = await tx.select({ status: users.status }).from(users).where(eq(users.id, reset.userId)).for("update").limit(1);
    if (user?.status !== "active") throw new Error("resetUnavailable");
    if (reset.issuedByOrganizationId) {
      // The clinic may only reset an account that is still its own (deactivated or joined another clinic since).
      const [scope] = await tx.execute<{ scope: string }>(sql`select app_private.staff_reset_scope(${reset.userId}, ${reset.issuedByOrganizationId}) as scope`);
      if (scope?.scope !== "ok") throw new Error("resetUnavailable");
    }
    const now = new Date();
    await tx.update(users).set({
      passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: now,
      ...(reset.resetMfa ? { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaRecoveryCodes: [] } : {}),
    }).where(eq(users.id, reset.userId));
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, reset.userId), isNull(sessions.revokedAt)));
    await tx.update(staffMfaChallenges).set({ usedAt: now }).where(and(eq(staffMfaChallenges.userId, reset.userId), isNull(staffMfaChallenges.usedAt)));
    await tx.update(staffPasswordResets).set({ usedAt: now }).where(eq(staffPasswordResets.id, reset.id));
    await tx.update(staffPasswordResets).set({ revokedAt: now })
      .where(and(eq(staffPasswordResets.userId, reset.userId), ne(staffPasswordResets.id, reset.id), isNull(staffPasswordResets.usedAt), isNull(staffPasswordResets.revokedAt)));
    if (reset.issuedByOrganizationId) {
      await tx.execute(sql`select set_config('app.org_id', ${reset.issuedByOrganizationId}, true), set_config('app.user_id', ${reset.userId}, true), set_config('app.actor_type', 'staff', true)`);
    }
    await audit(tx, {
      organizationId: reset.issuedByOrganizationId, actorType: "staff", actorUserId: reset.userId, action: "auth.password_reset.completed",
      entityType: "user", entityId: reset.userId, ipAddress, metadata: { resetId: reset.id, channel: reset.channel, resetMfa: reset.resetMfa },
    });
    return { userId: reset.userId };
  });
}

export type ResetEmail = { to: string; fullName: string; locale: string; link: string; minutes: number };

/**
 * "Forgot password" by email. Says nothing about whether the address exists: unknown, disabled or
 * throttled accounts silently get no email. `baseUrl` must come from configuration, never the request Host.
 */
export async function requestPasswordResetEmail(
  email: string, deps: { baseUrl: string; send: (mail: ResetEmail) => Promise<void> }, ipAddress: string | null = null, database: Database = db,
): Promise<void> {
  const rate = await consumeAuthRateLimit("password_reset", ipAddress, database);
  if (!rate.allowed) return;
  const [user] = await database.select({ id: users.id, email: users.email, fullName: users.fullName, locale: users.locale, status: users.status })
    .from(users).where(sql`lower(${users.email}) = lower(${email.trim()})`).limit(1);
  if (!user || user.status !== "active") return;
  const token = newToken();
  const created = await database.transaction(async (tx) => {
    // Serialize requests for one account so the hourly limit holds under concurrency.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    const [recent] = await tx.select({ n: count() }).from(staffPasswordResets).where(and(
      eq(staffPasswordResets.userId, user.id), eq(staffPasswordResets.channel, "email"), gt(staffPasswordResets.createdAt, new Date(Date.now() - 3_600_000)),
    ));
    if ((recent?.n ?? 0) >= EMAIL_RESETS_PER_HOUR) return false;
    await tx.update(staffPasswordResets).set({ revokedAt: new Date() })
      .where(and(eq(staffPasswordResets.userId, user.id), isNull(staffPasswordResets.usedAt), isNull(staffPasswordResets.revokedAt)));
    const [reset] = await tx.insert(staffPasswordResets).values({
      userId: user.id, tokenHash: hash(token), channel: "email", expiresAt: new Date(Date.now() + EMAIL_RESET_MINUTES * 60_000),
    }).returning({ id: staffPasswordResets.id });
    await audit(tx, { organizationId: null, actorType: "staff", actorUserId: user.id, action: "auth.password_reset.requested", entityType: "user", entityId: user.id, ipAddress, metadata: { resetId: reset!.id } });
    return true;
  });
  if (!created) return;
  await deps.send({ to: user.email, fullName: user.fullName, locale: user.locale, link: `${deps.baseUrl.replace(/\/+$/, "")}/reset-password/${token}`, minutes: EMAIL_RESET_MINUTES });
}

/** Signed-in staff changes their own password; their other sessions are signed out. */
export async function changeOwnPassword(ctx: ClinicContext, current: string, next: string): Promise<"ok" | "invalid" | string> {
  const policy = passwordPolicyError(next);
  if (policy) return policy;
  const passwordHash = await hashPassword(next);
  return withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, async (tx) => {
    const [user] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, ctx.userId)).for("update").limit(1);
    if (!user || !(await verifyPassword(current, user.passwordHash))) return "invalid";
    const now = new Date();
    await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, ctx.userId));
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, ctx.userId), ne(sessions.id, ctx.sessionId), isNull(sessions.revokedAt)));
    await tx.update(staffPasswordResets).set({ revokedAt: now })
      .where(and(eq(staffPasswordResets.userId, ctx.userId), isNull(staffPasswordResets.usedAt), isNull(staffPasswordResets.revokedAt)));
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "auth.password.changed", entityType: "user", entityId: ctx.userId });
    return "ok";
  });
}
