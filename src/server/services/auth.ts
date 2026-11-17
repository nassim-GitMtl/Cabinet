import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { audit } from "../audit";
import { db, type Database } from "../db/client";
import { memberships, organizations, users } from "../db/schema";
import { withDbContext } from "../db/tenant";
import { hashPassword, verifyPassword } from "../auth/password";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Verifying against a dummy hash for unknown emails keeps response time
// uniform, so login timing does not reveal which emails exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password-placeholder"));

export type AuthResult =
  | { ok: true; userId: string; mfaRequired: boolean }
  | { ok: false; reason: "invalid" | "locked" | "disabled" };

export async function authenticate(
  email: string,
  password: string,
  ipAddress: string | null,
  database: Database = db,
): Promise<AuthResult> {
  const [user] = await database
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email.trim()})`)
    .limit(1);

  if (!user) {
    await verifyPassword(password, await getDummyHash());
    return { ok: false, reason: "invalid" };
  }
  if (user.status !== "active") return { ok: false, reason: "disabled" };
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, reason: "locked" };

  const valid = await verifyPassword(password, user.passwordHash);
  await database.transaction(async (tx) => {
    if (valid) {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(users.id, user.id));
    } else {
      const failed = user.failedLoginCount + 1;
      await tx
        .update(users)
        .set({
          failedLoginCount: failed >= MAX_FAILED_ATTEMPTS ? 0 : failed,
          lockedUntil:
            failed >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
    }
    await audit(tx, {
      organizationId: null,
      actorType: "staff",
      actorUserId: user.id,
      action: valid ? "auth.login.succeeded" : "auth.login.failed",
      ipAddress,
    });
  });
  return valid ? { ok: true, userId: user.id, mfaRequired: user.mfaEnabled } : { ok: false, reason: "invalid" };
}

export type MyClinic = { organizationId: string; name: string; displayName: string };

/** Active clinic memberships of a user (RLS: user sees own memberships only). */
export async function listMyClinics(userId: string, database: Database = db): Promise<MyClinic[]> {
  return withDbContext(
    { userId, actorType: "staff" },
    (tx) =>
      tx
        .select({
          organizationId: memberships.organizationId,
          name: organizations.name,
          displayName: memberships.displayName,
        })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
        .orderBy(asc(organizations.name)),
    database,
  );
}
