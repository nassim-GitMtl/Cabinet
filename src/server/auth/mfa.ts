import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { audit } from "@/server/audit";
import type { ClinicContext } from "@/server/auth/context";
import { db } from "@/server/db/client";
import { sessions, staffMfaChallenges, users } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, protectTotpSecret, revealTotpSecret, totpUri, verifyTotp } from "./totp";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createMfaChallenge(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(staffMfaChallenges).values({ id: hash(token), userId, expiresAt: new Date(Date.now() + 5 * 60_000) });
  return token;
}

export async function verifyMfaChallenge(token: string, code: string, ipAddress: string | null) {
  return db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(staffMfaChallenges).where(and(
      eq(staffMfaChallenges.id, hash(token)), isNull(staffMfaChallenges.usedAt), gt(staffMfaChallenges.expiresAt, new Date()),
    )).for("update").limit(1);
    if (!challenge || challenge.attemptsRemaining <= 0) return null;
    const [user] = await tx.select({ secret: users.mfaSecret, recovery: users.mfaRecoveryCodes }).from(users).where(eq(users.id, challenge.userId)).limit(1);
    if (!user?.secret) return null;
    const recoveryHash = hashRecoveryCode(code);
    const recoveryIndex = user.recovery.indexOf(recoveryHash);
    const valid = verifyTotp(revealTotpSecret(user.secret), code) || recoveryIndex >= 0;
    if (!valid) {
      await tx.update(staffMfaChallenges).set({ attemptsRemaining: challenge.attemptsRemaining - 1 }).where(eq(staffMfaChallenges.id, challenge.id));
      await audit(tx, { organizationId: null, actorType: "staff", actorUserId: challenge.userId, action: "auth.mfa.failed", ipAddress });
      return null;
    }
    if (recoveryIndex >= 0) await tx.update(users).set({ mfaRecoveryCodes: user.recovery.filter((_, index) => index !== recoveryIndex) }).where(eq(users.id, challenge.userId));
    await tx.update(staffMfaChallenges).set({ usedAt: new Date() }).where(eq(staffMfaChallenges.id, challenge.id));
    await audit(tx, { organizationId: null, actorType: "staff", actorUserId: challenge.userId, action: "auth.mfa.succeeded", ipAddress });
    return challenge.userId;
  });
}

export async function beginMfaEnrollment(ctx: ClinicContext) {
  const secret = generateTotpSecret();
  await withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, async (tx) => {
    await tx.update(users).set({ mfaPendingSecret: protectTotpSecret(secret) }).where(eq(users.id, ctx.userId));
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "auth.mfa.enrollment_started", entityType: "user", entityId: ctx.userId });
  });
  return { secret, uri: totpUri(secret, ctx.user.email) };
}

export async function confirmMfaEnrollment(ctx: ClinicContext, code: string) {
  return withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, async (tx) => {
    const [user] = await tx.select({ pending: users.mfaPendingSecret }).from(users).where(eq(users.id, ctx.userId)).for("update").limit(1);
    if (!user?.pending || !verifyTotp(revealTotpSecret(user.pending), code)) return null;
    const recoveryCodes = generateRecoveryCodes();
    await tx.update(users).set({ mfaEnabled: true, mfaSecret: user.pending, mfaPendingSecret: null, mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode), updatedAt: new Date() }).where(eq(users.id, ctx.userId));
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "auth.mfa.enabled", entityType: "user", entityId: ctx.userId });
    return recoveryCodes;
  });
}

export async function disableMfa(ctx: ClinicContext, code: string) {
  return withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, async (tx) => {
    const [user] = await tx.select({ secret: users.mfaSecret, recovery: users.mfaRecoveryCodes }).from(users).where(eq(users.id, ctx.userId)).for("update").limit(1);
    if (!user?.secret) return false;
    const recoveryHash = hashRecoveryCode(code);
    if (!verifyTotp(revealTotpSecret(user.secret), code) && !user.recovery.includes(recoveryHash)) return false;
    await tx.update(users).set({ mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaRecoveryCodes: [], updatedAt: new Date() }).where(eq(users.id, ctx.userId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, ctx.userId), ne(sessions.id, ctx.sessionId), isNull(sessions.revokedAt)));
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "auth.mfa.disabled", entityType: "user", entityId: ctx.userId });
    return true;
  });
}

export async function isMfaEnabled(userId: string) {
  const [user] = await db.select({ enabled: users.mfaEnabled }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.enabled ?? false;
}
