import "server-only";
import { planConsumptionsForProcedure } from "@/features/inventory/consumables";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { todayInZone } from "@/lib/dates";
import { audit } from "@/server/audit";
import {
  requirePermission,
  tenantTx,
  type ClinicContext,
} from "@/server/auth/context";
import {
  branches,
  encounters,
  memberships,
  patients,
  performedProcedures,
  services,
  type ServiceSnapshot,
} from "@/server/db/schema";
import { ConflictError } from "@/server/errors";
import type { PerformedProcedureInput, ProcedureStatusInput } from "./schemas";

export class ProcedureReferenceError extends Error {
  constructor(public readonly code: "patientUnavailable" | "serviceUnavailable" | "providerUnavailable" | "branchUnavailable") {
    super(code);
  }
}

export class ProcedureValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Invalid performed procedure");
  }
}

function anatomyValues(
  anatomy: ServiceSnapshot["anatomy"],
  input: PerformedProcedureInput,
) {
  const errors: Record<string, string> = {};
  if ((anatomy === "tooth" || anatomy === "surface") && !input.toothNumber) {
    errors.toothNumber = "required";
  }
  if (anatomy === "surface" && input.surfaces.length === 0) {
    errors.surfaces = "required";
  }
  if (anatomy === "arch" && !input.arch) errors.arch = "required";
  if (anatomy === "quadrant" && !input.quadrant) errors.quadrant = "required";
  if (Object.keys(errors).length) throw new ProcedureValidationError(errors);

  return {
    toothNumber: anatomy === "tooth" || anatomy === "surface" ? input.toothNumber : null,
    surfaces: anatomy === "surface" ? input.surfaces : [],
    arch: anatomy === "arch" ? input.arch : null,
    quadrant: anatomy === "quadrant" ? input.quadrant : null,
  };
}

export async function getProcedureEntrySupport(ctx: ClinicContext) {
  requirePermission(ctx, "clinical.write");
  return tenantTx(ctx, async (tx) => {
    const [clinicBranches, providers] = await Promise.all([
      tx
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(eq(branches.isActive, true))
        .orderBy(asc(branches.name)),
      tx
        .select({
          id: memberships.id,
          displayName: memberships.displayName,
          title: memberships.title,
        })
        .from(memberships)
        .where(and(eq(memberships.isProvider, true), eq(memberships.status, "active")))
        .orderBy(asc(memberships.displayName)),
    ]);
    return { branches: clinicBranches, providers };
  });
}

export async function recordPerformedProcedure(
  ctx: ClinicContext,
  patientId: string,
  input: PerformedProcedureInput,
) {
  requirePermission(ctx, "clinical.write");
  requirePermission(ctx, "catalog.read");

  if (input.serviceDate > todayInZone(ctx.organization.timezone)) {
    throw new ProcedureValidationError({ serviceDate: "futureDate" });
  }
  if (!Number.isSafeInteger(input.unitPriceMinor * input.quantity)) {
    throw new ProcedureValidationError({ unitPriceMinor: "invalidAmount" });
  }

  return tenantTx(ctx, async (tx) => {
    const [[patient], [service], [provider], [branch]] = await Promise.all([
      tx
        .select({ id: patients.id, status: patients.status })
        .from(patients)
        .where(eq(patients.id, patientId))
        .limit(1),
      tx.select().from(services).where(eq(services.id, input.serviceId)).limit(1),
      tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.performingProviderId),
            eq(memberships.status, "active"),
            eq(memberships.isProvider, true),
          ),
        )
        .limit(1),
      tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, input.branchId), eq(branches.isActive, true)))
        .limit(1),
    ]);

    if (!patient || patient.status === "archived" || patient.status === "deceased") {
      throw new ProcedureReferenceError("patientUnavailable");
    }
    if (!service?.isActive) throw new ProcedureReferenceError("serviceUnavailable");
    if (!provider) throw new ProcedureReferenceError("providerUnavailable");
    if (!branch) throw new ProcedureReferenceError("branchUnavailable");

    const anatomy = anatomyValues(service.anatomy, input);
    const isPriceOverride = input.unitPriceMinor !== service.priceMinor;
    if (isPriceOverride) {
      if (!input.priceOverrideReason) {
        throw new ProcedureValidationError({ priceOverrideReason: "overrideReasonRequired" });
      }
      requirePermission(ctx, "price.override");
    }

    const now = new Date();
    const [encounter] = await tx
      .insert(encounters)
      .values({
        organizationId: ctx.organizationId,
        patientId,
        branchId: input.branchId,
        primaryProviderId: input.performingProviderId,
        serviceDate: input.serviceDate,
        status: "completed",
        completedAt: now,
        createdByUserId: ctx.userId,
      })
      .returning({ id: encounters.id });

    const snapshot: ServiceSnapshot = {
      code: service.code,
      name: service.name,
      pricingUnit: service.pricingUnit,
      anatomy: service.anatomy,
      taxRateBp: service.taxRateBp,
    };
    const [procedure] = await tx
      .insert(performedProcedures)
      .values({
        organizationId: ctx.organizationId,
        encounterId: encounter!.id,
        patientId,
        serviceId: service.id,
        serviceSnapshot: snapshot,
        ...anatomy,
        quantity: input.quantity,
        unitPriceMinor: input.unitPriceMinor,
        currency: service.currency,
        priceOverrideReason: isPriceOverride ? input.priceOverrideReason : null,
        priceOverrideApprovedByUserId: isPriceOverride ? ctx.userId : null,
        performingProviderId: input.performingProviderId,
        serviceDate: input.serviceDate,
        status: "completed",
        createdByUserId: ctx.userId,
      })
      .returning({ id: performedProcedures.id });

    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: "performed_procedure.created",
      entityType: "performed_procedure",
      entityId: procedure!.id,
      patientId,
      metadata: {
        encounterId: encounter!.id,
        serviceId: service.id,
        priceOverridden: isPriceOverride,
      },
    });
    // Stock use from the service recipe (suggested or automatic per clinic setting; never blocks care).
    await planConsumptionsForProcedure(
      tx,
      ctx,
      { id: procedure!.id, serviceId: service.id, quantity: input.quantity, branchId: input.branchId },
      todayInZone(ctx.organization.timezone),
    );
    return { id: procedure!.id, encounterId: encounter!.id };
  });
}

export async function listPerformedProcedures(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "clinical.read");
  return tenantTx(ctx, (tx) =>
    tx
      .select({
        id: performedProcedures.id,
        encounterId: performedProcedures.encounterId,
        serviceId: performedProcedures.serviceId,
        serviceSnapshot: performedProcedures.serviceSnapshot,
        toothNumber: performedProcedures.toothNumber,
        surfaces: performedProcedures.surfaces,
        arch: performedProcedures.arch,
        quadrant: performedProcedures.quadrant,
        quantity: performedProcedures.quantity,
        unitPriceMinor: performedProcedures.unitPriceMinor,
        currency: performedProcedures.currency,
        priceOverrideReason: performedProcedures.priceOverrideReason,
        serviceDate: performedProcedures.serviceDate,
        status: performedProcedures.status,
        statusReason: performedProcedures.statusReason,
        createdAt: performedProcedures.createdAt,
        providerName: memberships.displayName,
        providerTitle: memberships.title,
      })
      .from(performedProcedures)
      .innerJoin(memberships, eq(memberships.id, performedProcedures.performingProviderId))
      .where(eq(performedProcedures.patientId, patientId))
      .orderBy(desc(performedProcedures.serviceDate), desc(performedProcedures.createdAt)),
  );
}

export async function changePerformedProcedureStatus(
  ctx: ClinicContext,
  procedureId: string,
  input: ProcedureStatusInput,
) {
  requirePermission(ctx, "clinical.write");
  return tenantTx(ctx, async (tx) => {
    const [updated] = await tx
      .update(performedProcedures)
      .set({
        status: input.status,
        statusReason: input.reason,
        statusChangedAt: new Date(),
        statusChangedByUserId: ctx.userId,
      })
      .where(
        and(
          eq(performedProcedures.id, procedureId),
          eq(performedProcedures.status, "completed"),
        ),
      )
      .returning({
        patientId: performedProcedures.patientId,
        encounterId: performedProcedures.encounterId,
      });
    if (!updated) throw new ConflictError();

    const [{ activeCount }] = await tx
      .select({ activeCount: sql<number>`count(*) filter (where ${performedProcedures.status} = 'completed')::int` })
      .from(performedProcedures)
      .where(eq(performedProcedures.encounterId, updated.encounterId));
    if (activeCount === 0) {
      await tx
        .update(encounters)
        .set({ status: input.status === "entered_in_error" ? "entered_in_error" : "cancelled" })
        .where(eq(encounters.id, updated.encounterId));
    }

    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action:
        input.status === "reversed"
          ? "performed_procedure.reversed"
          : "performed_procedure.entered_in_error",
      entityType: "performed_procedure",
      entityId: procedureId,
      patientId: updated.patientId,
      metadata: { status: input.status },
    });
    return updated.patientId;
  });
}
