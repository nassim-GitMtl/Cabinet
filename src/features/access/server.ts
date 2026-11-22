import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { type Permission, ASSIGNABLE_PERMISSIONS } from "@/server/authz/permissions";
import { memberships, roles, sessions, staffInvitations, users } from "@/server/db/schema";
import type { z } from "zod";
import type { roleSchema, staffInvitationSchema } from "./schemas";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class AccessError extends Error { constructor(public readonly code: "roleUnavailable" | "memberUnavailable" | "ownerProtected" | "selfProtected" | "alreadyMember") { super(code); } }

export async function getAccessSettings(ctx: ClinicContext) {
  requirePermission(ctx, "org.staff.manage");
  return tenantTx(ctx, async (tx) => {
    const [staff, roleRows, invitations] = await Promise.all([
      tx.select({ id: memberships.id, userId: memberships.userId, displayName: memberships.displayName, title: memberships.title, isProvider: memberships.isProvider, status: memberships.status, roleId: roles.id, roleName: roles.name, roleKey: roles.key, email: users.email })
        .from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).innerJoin(users, eq(users.id, memberships.userId)).orderBy(asc(memberships.displayName)),
      tx.select().from(roles).orderBy(asc(roles.name)),
      tx.select({ id: staffInvitations.id, email: staffInvitations.email, fullName: staffInvitations.fullName, expiresAt: staffInvitations.expiresAt, acceptedAt: staffInvitations.acceptedAt, createdAt: staffInvitations.createdAt, roleName: roles.name, roleKey: roles.key })
        .from(staffInvitations).innerJoin(roles, eq(roles.id, staffInvitations.roleId)).orderBy(desc(staffInvitations.createdAt)).limit(20),
    ]);
    return { staff, roles: roleRows, invitations };
  });
}

export async function listRoles(ctx: ClinicContext) {
  requirePermission(ctx, "org.roles.manage");
  return tenantTx(ctx, (tx) => tx.select().from(roles).orderBy(asc(roles.name)));
}

export async function createStaffInvitation(ctx: ClinicContext, input: z.infer<typeof staffInvitationSchema>) {
  requirePermission(ctx, "org.staff.manage");
  return tenantTx(ctx, async (tx) => {
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, input.roleId)).limit(1);
    if (!role) throw new AccessError("roleUnavailable");
    const [existing] = await tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(sql`lower(${users.email}) = lower(${input.email})`).limit(1);
    if (existing) throw new AccessError("alreadyMember");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const [invitation] = await tx.insert(staffInvitations).values({ organizationId: ctx.organizationId, email: input.email, fullName: input.fullName, roleId: input.roleId, title: input.title, isProvider: input.isProvider, tokenHash: hash(token), expiresAt, createdByUserId: ctx.userId }).returning({ id: staffInvitations.id });
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "staff.invited", entityType: "staff_invitation", entityId: invitation!.id, metadata: { roleId: input.roleId } });
    return { token, expiresAt };
  });
}

/** Known keys a role other than the owner may hold (practitioner-fee keys stay with the owner). */
const assignable = (keys: readonly string[]) =>
  keys.filter((k): k is Permission => (ASSIGNABLE_PERMISSIONS as readonly string[]).includes(k));

export async function createRole(ctx: ClinicContext, input: z.infer<typeof roleSchema>) {
  requirePermission(ctx, "org.roles.manage");
  return tenantTx(ctx, async (tx) => {
    const permissions = assignable(input.permissions);
    const [role] = await tx.insert(roles).values({ organizationId: ctx.organizationId, key: `custom_${randomUUID()}`, name: input.name, permissions }).returning({ id: roles.id });
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "role.created", entityType: "role", entityId: role!.id, metadata: { permissions } });
    return role!.id;
  });
}

export async function updateRole(ctx: ClinicContext, roleId: string, input: z.infer<typeof roleSchema>) {
  requirePermission(ctx, "org.roles.manage");
  return tenantTx(ctx, async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, roleId)).for("update").limit(1);
    if (!role) throw new AccessError("roleUnavailable");
    if (role.key === "owner") throw new AccessError("ownerProtected");
    const permissions = assignable(input.permissions);
    await tx.update(roles).set({ name: input.name, permissions, updatedAt: new Date() }).where(eq(roles.id, role.id));
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "role.updated", entityType: "role", entityId: role.id, metadata: { permissions } });
  });
}

export async function updateMembership(ctx: ClinicContext, membershipId: string, roleId: string, status: "active" | "deactivated") {
  requirePermission(ctx, "org.staff.manage");
  return tenantTx(ctx, async (tx) => {
    const [member] = await tx.select({ membership: memberships, roleKey: roles.key }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(eq(memberships.id, membershipId)).for("update").limit(1);
    if (!member) throw new AccessError("memberUnavailable");
    if (member.roleKey === "owner") throw new AccessError("ownerProtected");
    if (member.membership.userId === ctx.userId) throw new AccessError("selfProtected");
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) throw new AccessError("roleUnavailable");
    await tx.update(memberships).set({ roleId, status, deactivatedAt: status === "deactivated" ? new Date() : null }).where(eq(memberships.id, membershipId));
    if (status === "deactivated") await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, member.membership.userId), isNull(sessions.revokedAt)));
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: `staff.${status}`, entityType: "membership", entityId: membershipId, metadata: { roleId } });
  });
}
