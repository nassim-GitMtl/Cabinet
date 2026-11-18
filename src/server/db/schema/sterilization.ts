// Sterilization traceability (brief §23): sterilizers, instrument sets, cycles, packs and their use on patients.
// Recording a cycle never certifies it: packs become usable only after an explicit, authorized release.
import { boolean, date, index, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id, organizationId } from "./_shared";
import { performedProcedures } from "./clinical";
import { patients } from "./patients";
import { branches, organizations, users } from "./platform";

export const sterilizationIndicatorResult = pgEnum("sterilization_indicator_result", ["not_used", "pending", "pass", "fail"]);
export const sterilizationCycleStatus = pgEnum("sterilization_cycle_status", ["pending_release", "released", "failed", "recalled"]);

export const sterilizers = pgTable(
  "sterilizers",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    name: text("name").notNull(),
    serialNumber: text("serial_number"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sterilizers_org_name_uq").on(t.organizationId, sql`lower(${t.name})`)],
);

export const instrumentSets = pgTable(
  "instrument_sets",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    contents: text("contents"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("instrument_sets_org_code_uq").on(t.organizationId, sql`upper(${t.code})`)],
);

export const sterilizationCycles = pgTable(
  "sterilization_cycles",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    sterilizerId: uuid("sterilizer_id").notNull().references(() => sterilizers.id),
    /** Cycle number/counter shown by the machine. */
    reference: text("reference").notNull(),
    program: text("program").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    operatorUserId: uuid("operator_user_id").notNull().references(() => users.id),
    temperatureC: numeric("temperature_c", { precision: 5, scale: 1 }),
    pressureBar: numeric("pressure_bar", { precision: 5, scale: 2 }),
    holdMinutes: numeric("hold_minutes", { precision: 5, scale: 1 }),
    chemicalIndicator: sterilizationIndicatorResult("chemical_indicator").notNull(),
    airRemovalTest: sterilizationIndicatorResult("air_removal_test").notNull(),
    biologicalIndicator: sterilizationIndicatorResult("biological_indicator").notNull(),
    notes: text("notes"),
    status: sterilizationCycleStatus("status").notNull().default("pending_release"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    recalledByUserId: uuid("recalled_by_user_id").references(() => users.id),
    recalledAt: timestamp("recalled_at", { withTimezone: true }),
    recallReason: text("recall_reason"),
    biologicalRecordedByUserId: uuid("biological_recorded_by_user_id").references(() => users.id),
    biologicalRecordedAt: timestamp("biological_recorded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sterilization_cycles_reference_uq").on(t.organizationId, t.sterilizerId, sql`lower(${t.reference})`),
    index("sterilization_cycles_recent_idx").on(t.organizationId, t.startedAt),
  ],
);

export const sterilizationPacks = pgTable(
  "sterilization_packs",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    cycleId: uuid("cycle_id").notNull().references(() => sterilizationCycles.id),
    instrumentSetId: uuid("instrument_set_id").references(() => instrumentSets.id),
    /** Printed, scannable label, e.g. ST-2026-000123. */
    code: text("code").notNull(),
    /** Description for loose pouches without an instrument set. */
    label: text("label"),
    expiresOn: date("expires_on"),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardedByUserId: uuid("discarded_by_user_id").references(() => users.id),
    discardReason: text("discard_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sterilization_packs_org_code_uq").on(t.organizationId, t.code),
    index("sterilization_packs_cycle_idx").on(t.organizationId, t.cycleId),
  ],
);

export const sterilizationPackUses = pgTable(
  "sterilization_pack_uses",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    packId: uuid("pack_id").notNull().references(() => sterilizationPacks.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    performedProcedureId: uuid("performed_procedure_id").references(() => performedProcedures.id),
    usedOn: date("used_on").notNull(),
    usedByUserId: uuid("used_by_user_id").notNull().references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: uuid("voided_by_user_id").references(() => users.id),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    // A pack is opened for one patient; a wrong link is voided (with reason) before relinking.
    uniqueIndex("sterilization_pack_uses_active_uq").on(t.packId).where(sql`${t.voidedAt} is null`),
    index("sterilization_pack_uses_patient_idx").on(t.organizationId, t.patientId),
  ],
);
