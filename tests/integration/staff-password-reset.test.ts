import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { acceptStaffInvitation } from "@/features/access/invitation";
import { createStaffInvitation, getAccessSettings, updateMembership } from "@/features/access/server";
import { ForbiddenError, type ClinicContext } from "@/server/auth/context";
import {
  changeOwnPassword, createStaffPasswordReset, EMAIL_RESETS_PER_HOUR, getStaffPasswordReset, PasswordResetError,
  requestPasswordResetEmail, resetStaffPassword, type ResetEmail,
} from "@/server/auth/password-reset";
import { db } from "@/server/db/client";
import { auditEvents, sessions, staffPasswordResets, users } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { authenticate } from "@/server/services/auth";
import { createServerResetLink } from "../../scripts/staff-reset-link";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const OLD = "old-password-123";
const NEW = "new-password-456";

async function addStaff(owner: ClinicContext, roleKey = "assistant", email = `staff-${randomUUID()}@example.test`) {
  const role = (await getAccessSettings(owner)).roles.find((r) => r.key === roleKey)!;
  const invite = await createStaffInvitation(owner, { email, fullName: "Samia Test", roleId: role.id, title: null, isProvider: false });
  const { userId } = await acceptStaffInvitation(invite.token, OLD);
  const membershipId = (await getAccessSettings(owner)).staff.find((s) => s.userId === userId)!.id;
  return { userId, email, membershipId };
}

async function openSession(userId: string) {
  const id = randomBytes(16).toString("hex");
  await db.insert(sessions).values({ id, userId, expiresAt: new Date(Date.now() + 86_400_000) });
  return id;
}
const revoked = async (id: string) => (await db.select({ at: sessions.revokedAt }).from(sessions).where(eq(sessions.id, id)))[0]!.at !== null;
const orgAudit = (ctx: ClinicContext, actions: string[]) => withDbContext({ organizationId: ctx.organizationId, actorType: "staff" }, (tx) =>
  tx.select({ action: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.organizationId, ctx.organizationId), inArray(auditEvents.action, actions))));

describe("staff password reset", () => {
  it("admin link: single use, new password works, lockout cleared, every session signed out, audited", async () => {
    const owner = await makeClinic("Cabinet Reset A");
    const staff = await addStaff(owner);
    const session = await openSession(staff.userId);
    await db.update(users).set({ failedLoginCount: 3, lockedUntil: new Date(Date.now() + 600_000) }).where(eq(users.id, staff.userId));

    const { token, expiresAt } = await createStaffPasswordReset(owner, staff.membershipId, { resetMfa: false });
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(await getStaffPasswordReset(token)).toMatchObject({ email: staff.email, clinicName: "Cabinet Reset A", resetMfa: false });

    await expect(resetStaffPassword(token, "short")).rejects.toThrow("password.tooShort");
    await resetStaffPassword(token, NEW);
    expect(await authenticate(staff.email, OLD, null)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await authenticate(staff.email, NEW, null)).toMatchObject({ ok: true, userId: staff.userId });
    expect(await revoked(session)).toBe(true);

    await expect(resetStaffPassword(token, "another-password-789")).rejects.toThrow("resetUnavailable");
    expect(await getStaffPasswordReset(token)).toBeNull();
    expect((await orgAudit(owner, ["staff.password_reset_link_created", "auth.password_reset.completed"])).map((a) => a.action).sort())
      .toEqual(["auth.password_reset.completed", "staff.password_reset_link_created"]);
  });

  it("refuses self, owner, other clinics' and shared accounts; needs org.staff.manage", async () => {
    const owner = await makeClinic("Cabinet Reset B");
    const staff = await addStaff(owner);
    const coOwner = await addStaff(owner, "owner");
    const reject = (ctx: ClinicContext, membershipId: string) => createStaffPasswordReset(ctx, membershipId, { resetMfa: false });

    const ownMembership = (await getAccessSettings(owner)).staff.find((s) => s.userId === owner.userId)!.id;
    await expect(reject(owner, ownMembership)).rejects.toMatchObject({ code: "selfProtected" });
    await expect(reject(owner, coOwner.membershipId)).rejects.toMatchObject({ code: "ownerProtected" });
    await expect(reject(contextFor(owner, "receptionist"), staff.membershipId)).rejects.toBeInstanceOf(ForbiddenError);

    // Another clinic cannot even see the membership.
    const other = await makeClinic("Cabinet Reset C");
    await expect(reject(other, staff.membershipId)).rejects.toMatchObject({ code: "memberUnavailable" });

    // Same person also works at clinic C: neither clinic may reset the shared account.
    const role = (await getAccessSettings(other)).roles.find((r) => r.key === "assistant")!;
    const invite = await createStaffInvitation(other, { email: staff.email, fullName: "Samia Test", roleId: role.id, title: null, isProvider: false });
    await acceptStaffInvitation(invite.token, OLD);
    await expect(reject(owner, staff.membershipId)).rejects.toMatchObject({ code: "accountShared" });
    expect(PasswordResetError).toBeDefined();
  });

  it("a newer link or a deactivation voids the older link; 'lost phone' turns MFA off; rows are frozen", async () => {
    const owner = await makeClinic("Cabinet Reset D");
    const staff = await addStaff(owner);
    const first = await createStaffPasswordReset(owner, staff.membershipId, { resetMfa: false });
    const second = await createStaffPasswordReset(owner, staff.membershipId, { resetMfa: true });
    expect(await getStaffPasswordReset(first.token)).toBeNull();
    expect(await getStaffPasswordReset(second.token)).toMatchObject({ resetMfa: true });

    await db.update(users).set({ mfaEnabled: true, mfaSecret: "protected-secret", mfaRecoveryCodes: ["h1"] }).where(eq(users.id, staff.userId));
    await resetStaffPassword(second.token, NEW);
    const [after] = await db.select({ mfa: users.mfaEnabled, secret: users.mfaSecret, codes: users.mfaRecoveryCodes }).from(users).where(eq(users.id, staff.userId));
    expect(after).toEqual({ mfa: false, secret: null, codes: [] });

    const third = await createStaffPasswordReset(owner, staff.membershipId, { resetMfa: false });
    const roleId = (await getAccessSettings(owner)).staff.find((s) => s.userId === staff.userId)!.roleId;
    await updateMembership(owner, staff.membershipId, roleId, "deactivated");
    await expect(resetStaffPassword(third.token, "third-password-000")).rejects.toThrow("resetUnavailable");
    await expect(createStaffPasswordReset(owner, staff.membershipId, { resetMfa: false })).rejects.toMatchObject({ code: "memberUnavailable" });

    await expectDbError(db.update(staffPasswordResets).set({ resetMfa: true }).where(eq(staffPasswordResets.userId, staff.userId)), /only a single use or revocation/);
    // Expired links are refused.
    const expired = randomBytes(32).toString("base64url");
    await db.insert(staffPasswordResets).values({ userId: staff.userId, tokenHash: createHash("sha256").update(expired).digest("hex"), channel: "email", expiresAt: new Date(Date.now() - 1000) });
    expect(await getStaffPasswordReset(expired)).toBeNull();
  });

  it("forgot password by email: silent for unknown addresses, throttled, link from configuration", async () => {
    const owner = await makeClinic("Cabinet Reset E");
    const staff = await addStaff(owner);
    const sent: ResetEmail[] = [];
    const send = vi.fn(async (mail: ResetEmail) => { sent.push(mail); });
    const deps = { baseUrl: "https://cabinet.example.test/", send };

    await requestPasswordResetEmail("nobody-here@example.test", deps);
    expect(send).not.toHaveBeenCalled();

    for (let i = 0; i < EMAIL_RESETS_PER_HOUR + 1; i++) await requestPasswordResetEmail(staff.email.toUpperCase(), deps);
    expect(send).toHaveBeenCalledTimes(EMAIL_RESETS_PER_HOUR);
    expect(sent[0]).toMatchObject({ to: staff.email, fullName: "Samia Test", minutes: 60 });
    expect(sent[0]!.link).toMatch(/^https:\/\/cabinet\.example\.test\/reset-password\/[A-Za-z0-9_-]{43}$/);
    const tokens = sent.map((m) => m.link.split("/").pop()!);
    expect(await getStaffPasswordReset(tokens[0]!)).toBeNull(); // replaced by the newer email
    expect(await getStaffPasswordReset(tokens.at(-1)!)).toMatchObject({ email: staff.email, clinicName: null });
    await resetStaffPassword(tokens.at(-1)!, NEW);
    expect(await authenticate(staff.email, NEW, null)).toMatchObject({ ok: true });
  });

  it("signed-in staff change their own password; other devices are signed out", async () => {
    const owner = await makeClinic("Cabinet Reset F");
    const current = await openSession(owner.userId);
    const other = await openSession(owner.userId);
    const ctx = { ...owner, sessionId: current };
    expect(await changeOwnPassword(ctx, "wrong-password-0", NEW)).toBe("invalid");
    expect(await changeOwnPassword(ctx, "correct-horse-battery", "short")).toBe("password.tooShort");
    expect(await changeOwnPassword(ctx, "correct-horse-battery", NEW)).toBe("ok");
    expect([await revoked(current), await revoked(other)]).toEqual([false, true]);
    expect((await orgAudit(owner, ["auth.password.changed"])).length).toBe(1);
  });

  it("server command creates a link for the owner (nobody can create one in the app)", async () => {
    const owner = await makeClinic("Cabinet Reset G");
    const [{ email }] = await db.select({ email: users.email }).from(users).where(eq(users.id, owner.userId)) as [{ email: string }];
    const url = process.env.TEST_DATABASE_URL_ADMIN!;
    expect(await createServerResetLink(url, "nobody-here@example.test", { resetMfa: false })).toMatchObject({ error: expect.any(String) });
    const link = await createServerResetLink(url, email, { resetMfa: false });
    if ("error" in link) throw new Error(link.error);
    expect(await getStaffPasswordReset(link.token)).toMatchObject({ email, clinicName: null });
    await resetStaffPassword(link.token, NEW);
    expect(await authenticate(email, NEW, null)).toMatchObject({ ok: true, userId: owner.userId });
  });
});
