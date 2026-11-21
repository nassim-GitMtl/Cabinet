import { and, eq } from "drizzle-orm";
import type { ClinicContext } from "@/server/auth/context";
import { memberships, organizations, roles } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";

/** Builds a staff context for scripts (no HTTP session). */
export async function contextFromIds(userId: string, organizationId: string): Promise<ClinicContext> {
  return withDbContext({ organizationId, userId, actorType: "staff" }, async (tx) => {
    const [row] = await tx
      .select({ m: memberships, r: roles, o: organizations })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
    if (!row) throw new Error("Membership not found");
    return {
      sessionId: "script",
      userId,
      user: { id: userId, fullName: row.m.displayName, email: "", locale: "fr", platformRole: "none" },
      organizationId,
      membershipId: row.m.id,
      displayName: row.m.displayName,
      roleKey: row.r.key,
      roleName: row.r.name,
      permissions: row.r.permissions,
      readOnlyCopy: false,
      canManageClinicComputer: row.r.permissions.includes("org.settings.manage"),
      organization: {
        id: row.o.id,
        name: row.o.name,
        defaultCurrency: row.o.defaultCurrency,
        defaultLocale: row.o.defaultLocale,
        timezone: row.o.timezone,
        countryCode: row.o.countryCode,
        verificationStatus: row.o.verificationStatus,
        enabledModules: row.o.enabledModules,
        settings: row.o.settings,
      },
    };
  });
}
