import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import { withDbContext } from "../db/tenant";
import { audit } from "../audit";
import type { ClinicContext } from "./context";
import { clientIpFromHeaders } from "./client-ip";

export const SESSION_COOKIE = "cdp_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h absolute idle window for shared workstations
const RENEW_THRESHOLD_MS = 60 * 60 * 1000; // extend when < 1h left

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requestMeta() {
  const h = await headers();
  return {
    ipAddress: clientIpFromHeaders(h),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export async function createSession(userId: string, activeOrganizationId: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const meta = await requestMeta();
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    activeOrganizationId,
    expiresAt,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export type SessionRecord = {
  sessionId: string;
  userId: string;
  activeOrganizationId: string | null;
  user: { id: string; fullName: string; email: string; locale: string; platformRole: "none" | "operator" };
};

/** Validates the cookie against the database. Returns null if missing/expired/revoked. */
export async function readSession(): Promise<SessionRecord | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hashToken(token);
  const now = new Date();
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      activeOrganizationId: sessions.activeOrganizationId,
      expiresAt: sessions.expiresAt,
      fullName: users.fullName,
      email: users.email,
      locale: users.locale,
      platformRole: users.platformRole,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, id),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt.getTime() - now.getTime() < RENEW_THRESHOLD_MS) {
    // Sliding renewal. Cookie is refreshed by the next server action/route that can set cookies.
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS), lastSeenAt: now })
      .where(eq(sessions.id, id));
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    activeOrganizationId: row.activeOrganizationId,
    user: {
      id: row.userId,
      fullName: row.fullName,
      email: row.email,
      locale: row.locale,
      platformRole: row.platformRole,
    },
  };
}

export async function setActiveOrganization(sessionId: string, organizationId: string) {
  await db.update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.id, sessionId));
}

export async function revokeCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/** Revokes every session of a user (password change, deactivation, suspected compromise). */
export async function revokeAllSessions(userId: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function listUserSessions(userId: string) {
  return db.select({
    id: sessions.id, ipAddress: sessions.ipAddress, userAgent: sessions.userAgent,
    createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt,
  }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function revokeUserSession(userId: string, sessionId: string) {
  const [revoked] = await db.update(sessions).set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return !!revoked;
}

export async function revokeOwnSession(ctx: ClinicContext, sessionId: string) {
  return withDbContext({ organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" }, async (tx) => {
    const [revoked] = await tx.update(sessions).set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, ctx.userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (revoked) await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "auth.session.revoked", entityType: "session", entityId: sessionId });
    return !!revoked;
  });
}
