import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { acceptStaffInvitation, getStaffInvitation } from "@/features/access/invitation";
import { createRole, createStaffInvitation, getAccessSettings, updateMembership } from "@/features/access/server";
import { ForbiddenError } from "@/server/auth/context";
import { createMfaChallenge, beginMfaEnrollment, confirmMfaEnrollment, verifyMfaChallenge } from "@/server/auth/mfa";
import { listUserSessions, revokeUserSession } from "@/server/auth/session";
import { totpCode } from "@/server/auth/totp";
import { memberships, roles, sessions, staffInvitations, users } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { authenticate } from "@/server/services/auth";
import { contextFor, makeClinic } from "../support/factories";

describe("staff access and account security", () => {
  it("invites a new staff member into one tenant with an assigned custom role", async () => {
    const owner = await makeClinic("Cabinet Access A");
    const roleId = await createRole(owner, { name: "Accueil limité", permissions: ["patient.read", "appointment.read"] });
    const email = `staff-${randomUUID()}@example.test`;
    const invite = await createStaffInvitation(owner, { email, fullName: "Nora Staff", roleId, title: null, isProvider: false });
    expect(await getStaffInvitation(invite.token)).toMatchObject({ email, organizationName: "Cabinet Access A", existingUser: false });
    const accepted = await acceptStaffInvitation(invite.token, "staff-secure-password");
    expect(await getStaffInvitation(invite.token)).toBeNull();
    expect(await authenticate(email, "staff-secure-password", null)).toMatchObject({ ok: true, userId: accepted.userId });
    const access = await getAccessSettings(owner);
    expect(access.staff.find((member) => member.userId === accepted.userId)).toMatchObject({ roleId, status: "active" });

    const other = await makeClinic("Cabinet Access B");
    const hidden = await withDbContext({ organizationId: other.organizationId, userId: other.userId, actorType: "staff" }, (tx) => tx.select().from(staffInvitations).where(eq(staffInvitations.email, email)));
    expect(hidden).toEqual([]);
  });

  it("enforces role permissions, protects owners, and revokes sessions on deactivation", async () => {
    const owner = await makeClinic("Cabinet Access C");
    const roleId = await createRole(owner, { name: "Temporaire", permissions: ["catalog.read"] });
    const email = `temp-${randomUUID()}@example.test`;
    const invite = await createStaffInvitation(owner, { email, fullName: "Temp User", roleId, title: null, isProvider: false });
    const accepted = await acceptStaffInvitation(invite.token, "temporary-password");
    const [membership] = await withDbContext({ organizationId: owner.organizationId, userId: owner.userId, actorType: "staff" }, (tx) => tx.select().from(memberships).where(eq(memberships.userId, accepted.userId)));
    await withDbContext({ organizationId: owner.organizationId, userId: owner.userId, actorType: "staff" }, (tx) => tx.insert(sessions).values({ id: `test-${randomUUID()}`, userId: accepted.userId, activeOrganizationId: owner.organizationId, expiresAt: new Date(Date.now() + 60_000) }));
    await updateMembership(owner, membership!.id, roleId, "deactivated");
    expect(await listUserSessions(accepted.userId)).toEqual([]);
    const ownerMembership = (await withDbContext({ organizationId: owner.organizationId, userId: owner.userId, actorType: "staff" }, (tx) => tx.select({ id: memberships.id }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(eq(roles.key, "owner"))))[0]!;
    await expect(updateMembership(owner, ownerMembership.id, roleId, "deactivated")).rejects.toMatchObject({ code: "ownerProtected" });
    await expect(createRole(contextFor(owner, "tech_admin"), { name: "Forbidden", permissions: [] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("enables TOTP, requires a short-lived challenge, and supports session revocation", async () => {
    const owner = await makeClinic("Cabinet Access D");
    const [account] = await withDbContext({ organizationId: owner.organizationId, userId: owner.userId, actorType: "staff" }, (tx) => tx.select({ email: users.email }).from(users).where(eq(users.id, owner.userId)));
    const enrollment = await beginMfaEnrollment(owner);
    const recovery = await confirmMfaEnrollment(owner, totpCode(enrollment.secret));
    expect(recovery).toHaveLength(8);
    expect(await authenticate(account!.email, "correct-horse-battery", null)).toMatchObject({ ok: true, mfaRequired: true });
    const challenge = await createMfaChallenge(owner.userId);
    expect(await verifyMfaChallenge(challenge, "000000", null)).toBeNull();
    expect(await verifyMfaChallenge(challenge, totpCode(enrollment.secret), null)).toBe(owner.userId);
    expect(await verifyMfaChallenge(challenge, totpCode(enrollment.secret), null)).toBeNull();

    const id = `session-${randomUUID()}`;
    await withDbContext({ organizationId: owner.organizationId, userId: owner.userId, actorType: "staff" }, (tx) => tx.insert(sessions).values({ id, userId: owner.userId, activeOrganizationId: owner.organizationId, expiresAt: new Date(Date.now() + 60_000) }));
    expect((await listUserSessions(owner.userId)).some((session) => session.id === id)).toBe(true);
    expect(await revokeUserSession(owner.userId, id)).toBe(true);
    expect((await listUserSessions(owner.userId)).some((session) => session.id === id)).toBe(false);
  });
});
