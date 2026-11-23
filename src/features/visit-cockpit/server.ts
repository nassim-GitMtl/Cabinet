import "server-only";

import { and, asc, desc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { addDays, zonedToUtc } from "@/lib/dates";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  appointments,
  appointmentTypes,
  clinicalFiles,
  clinicalNotes,
  inventoryItems,
  memberships,
  odontogramFindings,
  patientAlerts,
  patients,
  performedProcedures,
  procedureConsumptions,
  services,
  treatmentPlanConversions,
  treatmentPlanItems,
  treatmentPlans,
  treatmentPlanVersions,
} from "@/server/db/schema";

/**
 * One read model for a chairside visit. It only assembles existing source
 * records: clinicians still approve notes, procedures, traceability and
 * outbound messages in their dedicated workflows.
 */
export async function getVisitCockpit(ctx: ClinicContext, patientId: string, serviceDate: string) {
  requirePermission(ctx, "patient.read");
  requirePermission(ctx, "clinical.read");

  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx
      .select({
        id: patients.id,
        patientNumber: patients.patientNumber,
        firstName: patients.firstName,
        lastName: patients.lastName,
        firstNameAr: patients.firstNameAr,
        lastNameAr: patients.lastNameAr,
        preferredLocale: patients.preferredLocale,
        status: patients.status,
      })
      .from(patients)
      .where(eq(patients.id, patientId))
      .limit(1);
    if (!patient) return null;

    const alerts = await tx
      .select({
        id: patientAlerts.id,
        kind: patientAlerts.kind,
        severity: patientAlerts.severity,
        label: patientAlerts.label,
        details: patientAlerts.details,
      })
      .from(patientAlerts)
      .where(and(eq(patientAlerts.patientId, patientId), isNull(patientAlerts.resolvedAt)))
      .orderBy(desc(patientAlerts.severity), desc(patientAlerts.createdAt));

    const start = zonedToUtc(serviceDate, "00:00", ctx.organization.timezone);
    const end = zonedToUtc(addDays(serviceDate, 1), "00:00", ctx.organization.timezone);
    const appointmentRows = can(ctx, "appointment.read")
      ? await tx
          .select({
            id: appointments.id,
            startsAt: appointments.startsAt,
            endsAt: appointments.endsAt,
            confirmationStatus: appointments.confirmationStatus,
            visitStatus: appointments.visitStatus,
            providerName: memberships.displayName,
            providerTitle: memberships.title,
            typeName: appointmentTypes.name,
          })
          .from(appointments)
          .innerJoin(memberships, eq(memberships.id, appointments.providerId))
          .leftJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
          .where(
            and(
              eq(appointments.patientId, patientId),
              ne(appointments.schedulingStatus, "cancelled"),
              gte(appointments.startsAt, start),
              lt(appointments.startsAt, end),
            ),
          )
          .orderBy(asc(appointments.startsAt))
      : [];

    const plannedItems = can(ctx, "treatment_plan.read")
      ? await tx
          .select({
            id: treatmentPlanItems.id,
            planId: treatmentPlans.id,
            title: treatmentPlanVersions.title,
            serviceSnapshot: treatmentPlanItems.serviceSnapshot,
            toothNumber: treatmentPlanItems.toothNumber,
            surfaces: treatmentPlanItems.surfaces,
            arch: treatmentPlanItems.arch,
            quadrant: treatmentPlanItems.quadrant,
            quantity: treatmentPlanItems.quantity,
          })
          .from(treatmentPlanItems)
          .innerJoin(treatmentPlanVersions, eq(treatmentPlanVersions.id, treatmentPlanItems.versionId))
          .innerJoin(
            treatmentPlans,
            and(
              eq(treatmentPlans.id, treatmentPlanVersions.planId),
              eq(treatmentPlans.currentVersion, treatmentPlanVersions.versionNumber),
            ),
          )
          .leftJoin(treatmentPlanConversions, eq(treatmentPlanConversions.itemId, treatmentPlanItems.id))
          .where(
            and(
              eq(treatmentPlans.patientId, patientId),
              eq(treatmentPlans.status, "accepted"),
              isNull(treatmentPlanConversions.id),
            ),
          )
          .orderBy(desc(treatmentPlans.updatedAt), asc(treatmentPlanItems.sortOrder))
      : [];

    const findingRows = await tx
      .select({
        id: odontogramFindings.id,
        toothNumber: odontogramFindings.toothNumber,
        surfaces: odontogramFindings.surfaces,
        kind: odontogramFindings.kind,
        status: odontogramFindings.status,
        supersedesId: odontogramFindings.supersedesId,
      })
      .from(odontogramFindings)
      .where(eq(odontogramFindings.patientId, patientId))
      .orderBy(desc(odontogramFindings.createdAt));
    const supersededFindingIds = new Set(findingRows.flatMap((row) => (row.supersedesId ? [row.supersedesId] : [])));
    const currentFindings = findingRows.filter((row) => !supersededFindingIds.has(row.id) && row.status === "active");

    const notes = await tx
      .select({
        id: clinicalNotes.id,
        kind: clinicalNotes.kind,
        status: clinicalNotes.status,
        serviceDate: clinicalNotes.serviceDate,
        currentVersion: clinicalNotes.currentVersion,
        providerName: memberships.displayName,
        providerTitle: memberships.title,
        updatedAt: clinicalNotes.updatedAt,
      })
      .from(clinicalNotes)
      .innerJoin(memberships, eq(memberships.id, clinicalNotes.providerId))
      .where(
        and(
          eq(clinicalNotes.patientId, patientId),
          eq(clinicalNotes.serviceDate, serviceDate),
          ne(clinicalNotes.status, "discarded"),
        ),
      )
      .orderBy(desc(clinicalNotes.updatedAt));

    const procedures = await tx
      .select({
        id: performedProcedures.id,
        serviceId: performedProcedures.serviceId,
        categoryId: services.categoryId,
        serviceSnapshot: performedProcedures.serviceSnapshot,
        toothNumber: performedProcedures.toothNumber,
        surfaces: performedProcedures.surfaces,
        arch: performedProcedures.arch,
        quadrant: performedProcedures.quadrant,
        quantity: performedProcedures.quantity,
        providerName: memberships.displayName,
        providerTitle: memberships.title,
      })
      .from(performedProcedures)
      .innerJoin(services, eq(services.id, performedProcedures.serviceId))
      .innerJoin(memberships, eq(memberships.id, performedProcedures.performingProviderId))
      .where(
        and(
          eq(performedProcedures.patientId, patientId),
          eq(performedProcedures.serviceDate, serviceDate),
          eq(performedProcedures.status, "completed"),
        ),
      )
      .orderBy(desc(performedProcedures.createdAt));

    const pendingConsumptions = can(ctx, "inventory.manage") || can(ctx, "clinical.write")
      ? await tx
          .select({
            id: procedureConsumptions.id,
            performedProcedureId: procedureConsumptions.performedProcedureId,
            itemName: inventoryItems.name,
            itemUnit: inventoryItems.unit,
            quantity: procedureConsumptions.quantity,
            note: procedureConsumptions.note,
            serviceSnapshot: performedProcedures.serviceSnapshot,
          })
          .from(procedureConsumptions)
          .innerJoin(performedProcedures, eq(performedProcedures.id, procedureConsumptions.performedProcedureId))
          .innerJoin(inventoryItems, eq(inventoryItems.id, procedureConsumptions.itemId))
          .where(
            and(
              eq(performedProcedures.patientId, patientId),
              eq(procedureConsumptions.status, "pending"),
            ),
          )
          .orderBy(asc(procedureConsumptions.createdAt))
      : [];

    const [fileSummary] = can(ctx, "clinical.images.read")
      ? await tx
          .select({
            count: sql<number>`count(*)::int`,
            latestClinicalDate: sql<string | null>`max(${clinicalFiles.clinicalDate})`,
          })
          .from(clinicalFiles)
          .where(eq(clinicalFiles.patientId, patientId))
      : [];

    const activeAppointment =
      appointmentRows.find((row) => row.visitStatus === "in_treatment") ??
      appointmentRows.find((row) => row.visitStatus === "waiting" || row.visitStatus === "arrived") ??
      appointmentRows.find((row) => row.visitStatus !== "completed") ??
      appointmentRows[0] ??
      null;

    return {
      patient,
      alerts,
      appointment: activeAppointment,
      plannedItems,
      currentFindings,
      notes,
      procedures,
      pendingConsumptions,
      fileSummary: fileSummary ?? null,
    };
  });
}
