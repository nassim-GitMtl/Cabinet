import "server-only";
import { asc, eq } from "drizzle-orm";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { memberships, roles, users } from "@/server/db/schema";

export async function listStaff(ctx: ClinicContext) {
  requirePermission(ctx, "org.staff.manage");
  return tenantTx(ctx, (tx) =>
    tx
      .select({
        id: memberships.id,
        displayName: memberships.displayName,
        title: memberships.title,
        isProvider: memberships.isProvider,
        status: memberships.status,
        roleName: roles.name,
        roleKey: roles.key,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(asc(memberships.displayName)),
  );
}
