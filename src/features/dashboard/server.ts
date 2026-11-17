import "server-only";
import { and, count, eq, gte, ne } from "drizzle-orm";
import { can, tenantTx, type ClinicContext } from "@/server/auth/context";
import { patients, services } from "@/server/db/schema";

/** Real counts only; every figure is derived from stored records. */
export async function getDashboardStats(ctx: ClinicContext) {
  return tenantTx(ctx, async (tx) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const patientStats = can(ctx, "patient.read")
      ? {
          active: (await tx.select({ n: count() }).from(patients).where(ne(patients.status, "archived")))[0]!.n,
          newLast30: (await tx.select({ n: count() }).from(patients).where(gte(patients.createdAt, since)))[0]!.n,
        }
      : null;
    const catalogStats = can(ctx, "catalog.read")
      ? {
          active: (await tx.select({ n: count() }).from(services).where(eq(services.isActive, true)))[0]!.n,
          demoPrices: (
            await tx
              .select({ n: count() })
              .from(services)
              .where(and(eq(services.isActive, true), eq(services.isDemoPrice, true)))
          )[0]!.n,
        }
      : null;
    return { patientStats, catalogStats };
  });
}
