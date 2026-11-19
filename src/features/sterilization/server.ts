import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  branches, instrumentSets, patients, performedProcedures, sterilizationCycles, sterilizationPacks,
  sterilizationPackUses, sterilizers,
} from "@/server/db/schema";
import { nextCounter } from "@/server/db/tenant";
import type { CreateInstrumentSetInput, CreateSterilizerInput, RecordCycleInput } from "./schemas";

export class SterilizationError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const actor = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

function requireSterilizationRead(ctx: ClinicContext) {
  if (can(ctx, "sterilization.manage")) requirePermission(ctx, "sterilization.manage");
  else requirePermission(ctx, "sterilization.release");
}

export async function getSterilizationDashboard(ctx: ClinicContext) {
  requireSterilizationRead(ctx);
  return tenantTx(ctx, async (tx) => {
    const [branchRows, equipment, setRows, cycles, packCounts] = await Promise.all([
      tx.select({ id: branches.id, name: branches.name, active: branches.isActive }).from(branches).orderBy(asc(branches.name)),
      tx.select({ sterilizer: sterilizers, branchName: branches.name }).from(sterilizers).innerJoin(branches, eq(branches.id, sterilizers.branchId)).orderBy(asc(sterilizers.name)),
      tx.select().from(instrumentSets).orderBy(asc(instrumentSets.name)),
      tx.select({ cycle: sterilizationCycles, sterilizerName: sterilizers.name, branchName: branches.name })
        .from(sterilizationCycles).innerJoin(sterilizers, eq(sterilizers.id, sterilizationCycles.sterilizerId))
        .innerJoin(branches, eq(branches.id, sterilizationCycles.branchId)).orderBy(desc(sterilizationCycles.startedAt)).limit(100),
      tx.select({ cycleId: sterilizationPacks.cycleId, count: sql<number>`count(*)::int` }).from(sterilizationPacks).groupBy(sterilizationPacks.cycleId),
    ]);
    const counts = new Map(packCounts.map((row) => [row.cycleId, Number(row.count)]));
    return { branches: branchRows, sterilizers: equipment, instrumentSets: setRows, cycles: cycles.map((row) => ({ ...row, packCount: counts.get(row.cycle.id) ?? 0 })) };
  });
}

export async function getSterilizationCycle(ctx: ClinicContext, cycleId: string) {
  requireSterilizationRead(ctx);
  return tenantTx(ctx, async (tx) => {
    const [record] = await tx.select({ cycle: sterilizationCycles, sterilizerName: sterilizers.name, branchName: branches.name })
      .from(sterilizationCycles).innerJoin(sterilizers, eq(sterilizers.id, sterilizationCycles.sterilizerId))
      .innerJoin(branches, eq(branches.id, sterilizationCycles.branchId)).where(eq(sterilizationCycles.id, cycleId)).limit(1);
    if (!record) return null;
    const packs = await tx.select({ pack: sterilizationPacks, setCode: instrumentSets.code, setName: instrumentSets.name })
      .from(sterilizationPacks).leftJoin(instrumentSets, eq(instrumentSets.id, sterilizationPacks.instrumentSetId))
      .where(eq(sterilizationPacks.cycleId, cycleId)).orderBy(asc(sterilizationPacks.code));
    const packIds = packs.map((row) => row.pack.id);
    const uses = packIds.length ? await tx.select({ use: sterilizationPackUses, patientNumber: patients.patientNumber, firstName: patients.firstName, lastName: patients.lastName, packCode: sterilizationPacks.code })
      .from(sterilizationPackUses).innerJoin(sterilizationPacks, eq(sterilizationPacks.id, sterilizationPackUses.packId))
      .innerJoin(patients, eq(patients.id, sterilizationPackUses.patientId)).where(inArray(sterilizationPackUses.packId, packIds))
      .orderBy(desc(sterilizationPackUses.createdAt)) : [];
    return { ...record, packs, uses };
  });
}

export async function createSterilizer(ctx: ClinicContext, input: CreateSterilizerInput) {
  requirePermission(ctx, "sterilization.manage");
  return tenantTx(ctx, async (tx) => {
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.isActive, true))).limit(1);
    if (!branch) throw new SterilizationError("branchUnavailable");
    const [duplicate] = await tx.select({ id: sterilizers.id }).from(sterilizers).where(sql`lower(${sterilizers.name}) = lower(${input.name})`).limit(1);
    if (duplicate) throw new SterilizationError("duplicateSterilizer");
    const [row] = await tx.insert(sterilizers).values({ organizationId: ctx.organizationId, branchId: input.branchId, name: input.name, serialNumber: input.serialNumber, createdByUserId: ctx.userId }).returning({ id: sterilizers.id });
    await audit(tx, { ...actor(ctx), action: "sterilization.sterilizer_created", entityType: "sterilizer", entityId: row!.id, metadata: { branchId: input.branchId } });
    return row!.id;
  });
}

export async function createInstrumentSet(ctx: ClinicContext, input: CreateInstrumentSetInput) {
  requirePermission(ctx, "sterilization.manage");
  return tenantTx(ctx, async (tx) => {
    const code = input.code.toUpperCase();
    const [duplicate] = await tx.select({ id: instrumentSets.id }).from(instrumentSets).where(sql`upper(${instrumentSets.code}) = ${code}`).limit(1);
    if (duplicate) throw new SterilizationError("duplicateSet");
    const [row] = await tx.insert(instrumentSets).values({ organizationId: ctx.organizationId, code, name: input.name, contents: input.contents, createdByUserId: ctx.userId }).returning({ id: instrumentSets.id });
    await audit(tx, { ...actor(ctx), action: "sterilization.instrument_set_created", entityType: "instrument_set", entityId: row!.id });
    return row!.id;
  });
}

export async function deactivateSterilizationSetup(ctx: ClinicContext, kind: "sterilizer" | "instrument_set", id: string) {
  requirePermission(ctx, "sterilization.manage");
  return tenantTx(ctx, async (tx) => {
    const table = kind === "sterilizer" ? sterilizers : instrumentSets;
    const [row] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.isActive, true))).limit(1);
    if (!row) throw new SterilizationError("setupUnavailable");
    await tx.update(table).set({ isActive: false }).where(eq(table.id, id));
    await audit(tx, { ...actor(ctx), action: `sterilization.${kind}_deactivated`, entityType: kind, entityId: id });
  });
}

export async function recordSterilizationCycle(ctx: ClinicContext, input: RecordCycleInput) {
  requirePermission(ctx, "sterilization.manage");
  return tenantTx(ctx, async (tx) => {
    const [[machine], setRows] = await Promise.all([
      tx.select({ id: sterilizers.id, branchId: sterilizers.branchId }).from(sterilizers).where(and(eq(sterilizers.id, input.sterilizerId), eq(sterilizers.isActive, true))).limit(1),
      tx.select({ id: instrumentSets.id }).from(instrumentSets).where(and(inArray(instrumentSets.id, input.packs.map((p) => p.instrumentSetId).filter((id): id is string => !!id)), eq(instrumentSets.isActive, true))),
    ]);
    if (!machine || machine.branchId !== input.branchId) throw new SterilizationError("sterilizerUnavailable");
    const requestedSetIds = [...new Set(input.packs.map((p) => p.instrumentSetId).filter((id): id is string => !!id))];
    if (setRows.length !== requestedSetIds.length) throw new SterilizationError("setUnavailable");
    const [duplicate] = await tx.select({ id: sterilizationCycles.id }).from(sterilizationCycles).where(and(eq(sterilizationCycles.sterilizerId, input.sterilizerId), sql`lower(${sterilizationCycles.reference}) = lower(${input.reference})`)).limit(1);
    if (duplicate) throw new SterilizationError("duplicateCycleReference");
    const [cycle] = await tx.insert(sterilizationCycles).values({
      organizationId: ctx.organizationId, branchId: input.branchId, sterilizerId: input.sterilizerId,
      reference: input.reference, program: input.program, startedAt: input.startedAt, operatorUserId: ctx.userId,
      temperatureC: input.temperatureC, pressureBar: input.pressureBar, holdMinutes: input.holdMinutes,
      chemicalIndicator: input.chemicalIndicator, airRemovalTest: input.airRemovalTest, biologicalIndicator: input.biologicalIndicator, notes: input.notes,
    }).returning({ id: sterilizationCycles.id });
    const expanded = input.packs.flatMap((pack) => Array.from({ length: pack.quantity }, () => pack));
    const year = input.startedDate.slice(0, 4);
    const values = [];
    for (const pack of expanded) {
      const sequence = await nextCounter(tx, ctx.organizationId, `sterilization_pack:${year}`);
      values.push({ organizationId: ctx.organizationId, cycleId: cycle!.id, instrumentSetId: pack.instrumentSetId, label: pack.label, expiresOn: pack.expiresOn, code: `ST-${year}-${String(sequence).padStart(6, "0")}` });
    }
    await tx.insert(sterilizationPacks).values(values);
    await audit(tx, { ...actor(ctx), action: "sterilization.cycle_recorded", entityType: "sterilization_cycle", entityId: cycle!.id, metadata: { branchId: input.branchId, sterilizerId: input.sterilizerId, packCount: values.length } });
    return cycle!.id;
  });
}

async function decide(ctx: ClinicContext, cycleId: string, status: "released" | "failed", note: string | null) {
  requirePermission(ctx, "sterilization.release");
  return tenantTx(ctx, async (tx) => {
    const [cycle] = await tx.select().from(sterilizationCycles).where(eq(sterilizationCycles.id, cycleId)).limit(1);
    if (!cycle || cycle.status !== "pending_release") throw new SterilizationError("cycleNotPending");
    if (status === "released" && [cycle.chemicalIndicator, cycle.airRemovalTest, cycle.biologicalIndicator].includes("fail")) throw new SterilizationError("failedIndicator");
    await tx.update(sterilizationCycles).set({ status, decisionNote: note, decidedAt: new Date(), decidedByUserId: ctx.userId }).where(eq(sterilizationCycles.id, cycleId));
    await audit(tx, { ...actor(ctx), action: `sterilization.cycle_${status}`, entityType: "sterilization_cycle", entityId: cycleId });
  });
}

export const releaseSterilizationCycle = (ctx: ClinicContext, id: string, note: string | null) => decide(ctx, id, "released", note);
export const failSterilizationCycle = (ctx: ClinicContext, id: string, reason: string) => decide(ctx, id, "failed", reason);

export async function recallSterilizationCycle(ctx: ClinicContext, cycleId: string, reason: string) {
  requirePermission(ctx, "sterilization.release");
  return tenantTx(ctx, async (tx) => {
    const [cycle] = await tx.select({ status: sterilizationCycles.status }).from(sterilizationCycles).where(eq(sterilizationCycles.id, cycleId)).limit(1);
    if (!cycle || cycle.status !== "released") throw new SterilizationError("cycleNotReleased");
    await tx.update(sterilizationCycles).set({ status: "recalled", recalledAt: new Date(), recalledByUserId: ctx.userId, recallReason: reason }).where(eq(sterilizationCycles.id, cycleId));
    await audit(tx, { ...actor(ctx), action: "sterilization.cycle_recalled", entityType: "sterilization_cycle", entityId: cycleId });
  });
}

export async function recordBiologicalResult(ctx: ClinicContext, cycleId: string, result: "pass" | "fail", reason: string | null) {
  requirePermission(ctx, "sterilization.release");
  return tenantTx(ctx, async (tx) => {
    const [cycle] = await tx.select({ status: sterilizationCycles.status, biological: sterilizationCycles.biologicalIndicator }).from(sterilizationCycles).where(eq(sterilizationCycles.id, cycleId)).limit(1);
    if (!cycle || cycle.biological !== "pending") throw new SterilizationError("biologicalNotPending");
    if (result === "fail" && cycle.status === "released" && !reason) throw new SterilizationError("biologicalFailureReason");
    const recalled = result === "fail" && cycle.status === "released";
    await tx.update(sterilizationCycles).set({ biologicalIndicator: result, biologicalRecordedAt: new Date(), biologicalRecordedByUserId: ctx.userId, ...(recalled ? { status: "recalled" as const, recalledAt: new Date(), recalledByUserId: ctx.userId, recallReason: reason } : {}) }).where(eq(sterilizationCycles.id, cycleId));
    await audit(tx, { ...actor(ctx), action: recalled ? "sterilization.biological_failed_recall" : "sterilization.biological_result", entityType: "sterilization_cycle", entityId: cycleId, metadata: { result } });
  });
}

export async function discardSterilizationPack(ctx: ClinicContext, packId: string, reason: string) {
  requirePermission(ctx, "sterilization.manage");
  return tenantTx(ctx, async (tx) => {
    const [pack] = await tx.select({ id: sterilizationPacks.id, discardedAt: sterilizationPacks.discardedAt }).from(sterilizationPacks).where(eq(sterilizationPacks.id, packId)).limit(1);
    if (!pack || pack.discardedAt) throw new SterilizationError("packUnavailable");
    const [use] = await tx.select({ id: sterilizationPackUses.id }).from(sterilizationPackUses).where(and(eq(sterilizationPackUses.packId, packId), isNull(sterilizationPackUses.voidedAt))).limit(1);
    if (use) throw new SterilizationError("packAlreadyUsed");
    await tx.update(sterilizationPacks).set({ discardedAt: new Date(), discardedByUserId: ctx.userId, discardReason: reason }).where(eq(sterilizationPacks.id, packId));
    await audit(tx, { ...actor(ctx), action: "sterilization.pack_discarded", entityType: "sterilization_pack", entityId: packId });
  });
}

export async function lookupSterilizationPack(ctx: ClinicContext, code: string) {
  requirePermission(ctx, "sterilization.manage");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx.select({ pack: sterilizationPacks, cycle: sterilizationCycles, setName: instrumentSets.name, setCode: instrumentSets.code })
      .from(sterilizationPacks).innerJoin(sterilizationCycles, eq(sterilizationCycles.id, sterilizationPacks.cycleId))
      .leftJoin(instrumentSets, eq(instrumentSets.id, sterilizationPacks.instrumentSetId))
      .where(sql`upper(${sterilizationPacks.code}) = ${code.trim().toUpperCase()}`).limit(1);
    if (!row) return null;
    const [activeUse] = await tx.select({ id: sterilizationPackUses.id }).from(sterilizationPackUses).where(and(eq(sterilizationPackUses.packId, row.pack.id), isNull(sterilizationPackUses.voidedAt))).limit(1);
    return { ...row, activeUse: activeUse ?? null };
  });
}

export async function linkSterilizationPack(ctx: ClinicContext, input: { packId: string; patientId: string; performedProcedureId: string | null; usedOn: string }) {
  requirePermission(ctx, "sterilization.manage"); requirePermission(ctx, "patient.read");
  return tenantTx(ctx, async (tx) => {
    const [[pack], [patient], procedure] = await Promise.all([
      tx.select({ id: sterilizationPacks.id }).from(sterilizationPacks).where(eq(sterilizationPacks.id, input.packId)).limit(1),
      tx.select({ id: patients.id }).from(patients).where(eq(patients.id, input.patientId)).limit(1),
      input.performedProcedureId ? tx.select({ id: performedProcedures.id, patientId: performedProcedures.patientId }).from(performedProcedures).where(eq(performedProcedures.id, input.performedProcedureId)).limit(1) : Promise.resolve([]),
    ]);
    if (!pack) throw new SterilizationError("packUnavailable");
    if (!patient) throw new SterilizationError("patientUnavailable");
    if (input.performedProcedureId && (!procedure[0] || procedure[0].patientId !== input.patientId)) throw new SterilizationError("procedureUnavailable");
    const [row] = await tx.insert(sterilizationPackUses).values({ organizationId: ctx.organizationId, packId: input.packId, patientId: input.patientId, performedProcedureId: input.performedProcedureId, usedOn: input.usedOn, usedByUserId: ctx.userId }).returning({ id: sterilizationPackUses.id });
    await audit(tx, { ...actor(ctx), action: "sterilization.pack_linked", entityType: "sterilization_pack_use", entityId: row!.id, metadata: { packId: input.packId, patientId: input.patientId, performedProcedureId: input.performedProcedureId } });
    return row!.id;
  });
}

export async function getPatientSterilization(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "sterilization.manage"); requirePermission(ctx, "patient.read");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select({ id: patients.id, patientNumber: patients.patientNumber, firstName: patients.firstName, lastName: patients.lastName }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient) return null;
    const [uses, procedures] = await Promise.all([
      tx.select({ use: sterilizationPackUses, pack: sterilizationPacks, cycle: sterilizationCycles, setName: instrumentSets.name, setCode: instrumentSets.code })
        .from(sterilizationPackUses).innerJoin(sterilizationPacks, eq(sterilizationPacks.id, sterilizationPackUses.packId))
        .innerJoin(sterilizationCycles, eq(sterilizationCycles.id, sterilizationPacks.cycleId)).leftJoin(instrumentSets, eq(instrumentSets.id, sterilizationPacks.instrumentSetId))
        .where(eq(sterilizationPackUses.patientId, patientId)).orderBy(desc(sterilizationPackUses.usedOn), desc(sterilizationPackUses.createdAt)),
      tx.select({ id: performedProcedures.id, serviceDate: performedProcedures.serviceDate, snapshot: performedProcedures.serviceSnapshot }).from(performedProcedures)
        .where(and(eq(performedProcedures.patientId, patientId), eq(performedProcedures.status, "completed"))).orderBy(desc(performedProcedures.serviceDate)).limit(100),
    ]);
    return { patient, uses, procedures };
  });
}

export async function voidSterilizationPackUse(ctx: ClinicContext, useId: string, reason: string) {
  requirePermission(ctx, "sterilization.manage"); requirePermission(ctx, "patient.read");
  return tenantTx(ctx, async (tx) => {
    const [use] = await tx.select({ id: sterilizationPackUses.id }).from(sterilizationPackUses).where(and(eq(sterilizationPackUses.id, useId), isNull(sterilizationPackUses.voidedAt))).limit(1);
    if (!use) throw new SterilizationError("useUnavailable");
    await tx.update(sterilizationPackUses).set({ voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: reason }).where(eq(sterilizationPackUses.id, useId));
    await audit(tx, { ...actor(ctx), action: "sterilization.pack_use_voided", entityType: "sterilization_pack_use", entityId: useId });
  });
}
