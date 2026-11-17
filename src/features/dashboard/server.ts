import "server-only";
import { and, count, desc, eq, gte, ne, sql } from "drizzle-orm";
import { todayInZone } from "@/lib/dates";
import { can, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  encounters,
  memberships,
  patients,
  performedProcedures,
  services,
} from "@/server/db/schema";

/** Real counts only; every figure is derived from stored records. */
export async function getDashboardStats(ctx: ClinicContext) {
  return tenantTx(ctx, async (tx) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const today = todayInZone(ctx.organization.timezone);
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

    const recentPatients = can(ctx, "patient.read")
      ? await tx
          .select({
            id: patients.id,
            patientNumber: patients.patientNumber,
            firstName: patients.firstName,
            lastName: patients.lastName,
            firstNameAr: patients.firstNameAr,
            lastNameAr: patients.lastNameAr,
            phone: patients.phone,
            createdAt: patients.createdAt,
          })
          .from(patients)
          .where(ne(patients.status, "archived"))
          .orderBy(desc(patients.createdAt))
          .limit(5)
      : null;

    const clinicalStats = can(ctx, "clinical.read")
      ? {
          visits: (
            await tx
              .select({ n: count() })
              .from(encounters)
              .where(and(eq(encounters.serviceDate, today), eq(encounters.status, "completed")))
          )[0]!.n,
          ...(
            await tx
              .select({
                procedures: count(),
                patients: sql<number>`count(distinct ${performedProcedures.patientId})::int`,
              })
              .from(performedProcedures)
              .where(
                and(
                  eq(performedProcedures.serviceDate, today),
                  eq(performedProcedures.status, "completed"),
                ),
              )
          )[0]!,
        }
      : null;

    const recentProcedures = can(ctx, "clinical.read") && can(ctx, "patient.read")
      ? await tx
          .select({
            id: performedProcedures.id,
            patientId: performedProcedures.patientId,
            patientNumber: patients.patientNumber,
            patientFirstName: patients.firstName,
            patientLastName: patients.lastName,
            patientFirstNameAr: patients.firstNameAr,
            patientLastNameAr: patients.lastNameAr,
            serviceSnapshot: performedProcedures.serviceSnapshot,
            serviceDate: performedProcedures.serviceDate,
            status: performedProcedures.status,
            providerName: memberships.displayName,
            providerTitle: memberships.title,
          })
          .from(performedProcedures)
          .innerJoin(patients, eq(patients.id, performedProcedures.patientId))
          .innerJoin(memberships, eq(memberships.id, performedProcedures.performingProviderId))
          .orderBy(desc(performedProcedures.serviceDate), desc(performedProcedures.createdAt))
          .limit(5)
      : null;

    return { patientStats, catalogStats, clinicalStats, recentPatients, recentProcedures };
  });
}
