import "server-only";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Tx } from "../db/client";
import { memberships, organizations, roles, type OrganizationSettings } from "../db/schema";
import { withDbContext } from "../db/tenant";
import { hasPermission, readOnlyCopyPermissions, roleEffectivePermissions, type Permission } from "../authz/permissions";
import { entitledPermissions, moduleEnabled, type ProductModule } from "../authz/modules";
import { nodeRole } from "../sync/node";
import { readSession, type SessionRecord } from "./session";

export type ClinicContext = {
  sessionId: string;
  userId: string;
  user: SessionRecord["user"];
  organizationId: string;
  membershipId: string;
  displayName: string;
  roleKey: string;
  roleName: string;
  permissions: readonly string[];
  /**
   * True on the cloud copy of a clinic whose clinic computer is in charge: `permissions` then only holds view
   * keys (see readOnlyCopyPermissions) and every staff write is refused by the database.
   */
  readOnlyCopy: boolean;
  /** May pair/unpair the clinic computer (kept even on a read-only copy, so the owner can take control back). */
  canManageClinicComputer: boolean;
  organization: {
    id: string;
    name: string;
    defaultCurrency: string;
    defaultLocale: string;
    timezone: string;
    countryCode: string;
    verificationStatus: string;
    enabledModules: string[];
    settings: OrganizationSettings;
  };
};

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
  }
}

/** Session only (no clinic). Cached per request. */
export const getSession = cache(readSession);

export async function requireSession(): Promise<SessionRecord> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Resolves the active clinic for the signed-in user and verifies an ACTIVE
 * membership on every request (deactivation takes effect immediately).
 * Returns null if there is no valid active clinic.
 */
export const getClinicContext = cache(async (): Promise<ClinicContext | null> => {
  const session = await getSession();
  if (!session?.activeOrganizationId) return null;
  const orgId = session.activeOrganizationId;

  const row = await withDbContext(
    { organizationId: orgId, userId: session.userId, actorType: "staff" },
    async (tx) => {
      const rows = await tx
        .select({
          membershipId: memberships.id,
          displayName: memberships.displayName,
          roleKey: roles.key,
          roleName: roles.name,
          permissions: roles.permissions,
          org: organizations,
        })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(
          and(
            eq(memberships.organizationId, orgId),
            eq(memberships.userId, session.userId),
            eq(memberships.status, "active"),
          ),
        )
        .limit(1);
      return rows[0];
    },
  );
  if (!row || row.org.status === "suspended" || row.org.status === "closed") return null;
  const readOnlyCopy = row.org.dataHome === "clinic" && (await nodeRole()) === "cloud";

  const entitled = entitledPermissions(roleEffectivePermissions(row.roleKey, row.permissions), row.org.enabledModules);
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    user: session.user,
    organizationId: orgId,
    membershipId: row.membershipId,
    displayName: row.displayName,
    roleKey: row.roleKey,
    roleName: row.roleName,
    permissions: readOnlyCopy ? readOnlyCopyPermissions(entitled) : entitled,
    readOnlyCopy,
    canManageClinicComputer: hasPermission(row.permissions, "org.settings.manage"),
    organization: {
      id: row.org.id,
      name: row.org.name,
      defaultCurrency: row.org.defaultCurrency,
      defaultLocale: row.org.defaultLocale,
      timezone: row.org.timezone,
      countryCode: row.org.countryCode,
      verificationStatus: row.org.verificationStatus,
      enabledModules: row.org.enabledModules,
      settings: row.org.settings,
    },
  };
});

export async function requireClinicContext(): Promise<ClinicContext> {
  const session = await requireSession();
  const ctx = await getClinicContext();
  if (!ctx) redirect(session.activeOrganizationId ? "/select-clinic?invalid=1" : "/select-clinic");
  return ctx;
}

export function can(ctx: ClinicContext, permission: Permission): boolean {
  return hasPermission(ctx.permissions, permission);
}

export function requirePermission(ctx: ClinicContext, permission: Permission): void {
  if (!can(ctx, permission)) throw new ForbiddenError(permission);
}

export function hasModule(ctx: ClinicContext, module: ProductModule): boolean {
  return moduleEnabled(ctx.organization.enabledModules, module);
}

export function requireModule(ctx: ClinicContext, module: ProductModule): void {
  if (!hasModule(ctx, module)) throw new ForbiddenError("org.modules.manage");
}

/** Tenant-scoped transaction for staff actions in the active clinic. */
export function tenantTx<T>(ctx: ClinicContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDbContext(
    { organizationId: ctx.organizationId, userId: ctx.userId, actorType: "staff" },
    fn,
  );
}
