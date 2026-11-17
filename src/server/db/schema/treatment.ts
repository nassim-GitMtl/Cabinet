import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt, version } from "./_shared";
import { dentalArch, dentalQuadrant, performedProcedures, type ServiceSnapshot } from "./clinical";
import { services } from "./catalog";
import { patients } from "./patients";
import { organizations, users } from "./platform";

export const treatmentPlanStatus = pgEnum("treatment_plan_status", [
  "draft",
  "proposed",
  "accepted",
  "declined",
  "completed",
  "cancelled",
]);

export const treatmentDecision = pgEnum("treatment_decision", ["accepted", "declined"]);
export const treatmentDecisionMethod = pgEnum("treatment_decision_method", [
  "signed_in_clinic",
  "verbal",
  "other",
]);

/** Mutable workflow pointer. Financial and clinical content lives in immutable versions. */
export const treatmentPlans = pgTable(
  "treatment_plans",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    status: treatmentPlanStatus("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    check("treatment_plans_current_version_positive", sql`${t.currentVersion} > 0`),
    index("treatment_plans_patient_idx").on(t.organizationId, t.patientId, t.updatedAt),
  ],
);

/** Append-only estimate header. Every revision inserts a complete new version. */
export const treatmentPlanVersions = pgTable(
  "treatment_plan_versions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    planId: uuid("plan_id").notNull().references(() => treatmentPlans.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    currency: text("currency").notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("treatment_plan_versions_number_positive", sql`${t.versionNumber} > 0`),
    check("treatment_plan_versions_total_nonnegative", sql`${t.totalMinor} >= 0`),
    uniqueIndex("treatment_plan_versions_plan_number_uq").on(t.planId, t.versionNumber),
    index("treatment_plan_versions_patient_idx").on(t.organizationId, t.patientId, t.createdAt),
  ],
);

/** Append-only service and price snapshots belonging to one estimate version. */
export const treatmentPlanItems = pgTable(
  "treatment_plan_items",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    versionId: uuid("version_id").notNull().references(() => treatmentPlanVersions.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    serviceId: uuid("service_id").notNull().references(() => services.id),
    serviceSnapshot: jsonb("service_snapshot").$type<ServiceSnapshot>().notNull(),
    sortOrder: integer("sort_order").notNull(),
    toothNumber: text("tooth_number"),
    surfaces: text("surfaces").array().notNull().default(sql`'{}'::text[]`),
    arch: dentalArch("arch"),
    quadrant: dentalQuadrant("quadrant"),
    quantity: integer("quantity").notNull().default(1),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("treatment_plan_items_quantity_positive", sql`${t.quantity} > 0`),
    check("treatment_plan_items_price_nonnegative", sql`${t.unitPriceMinor} >= 0`),
    uniqueIndex("treatment_plan_items_version_order_uq").on(t.versionId, t.sortOrder),
    index("treatment_plan_items_version_idx").on(t.versionId),
  ],
);

/** Append-only patient decision tied to the exact immutable estimate version. */
export const treatmentPlanDecisions = pgTable(
  "treatment_plan_decisions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    planId: uuid("plan_id").notNull().references(() => treatmentPlans.id),
    versionId: uuid("version_id").notNull().references(() => treatmentPlanVersions.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    decision: treatmentDecision("decision").notNull(),
    method: treatmentDecisionMethod("method").notNull(),
    note: text("note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    recordedByUserId: uuid("recorded_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("treatment_plan_decisions_version_uq").on(t.versionId),
    index("treatment_plan_decisions_patient_idx").on(t.organizationId, t.patientId, t.decidedAt),
  ],
);

/** Append-only link proving which accepted item produced a performed procedure. */
export const treatmentPlanConversions = pgTable(
  "treatment_plan_conversions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    planId: uuid("plan_id").notNull().references(() => treatmentPlans.id),
    versionId: uuid("version_id").notNull().references(() => treatmentPlanVersions.id),
    itemId: uuid("item_id").notNull().references(() => treatmentPlanItems.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    performedProcedureId: uuid("performed_procedure_id").notNull().references(() => performedProcedures.id),
    convertedByUserId: uuid("converted_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("treatment_plan_conversions_item_uq").on(t.itemId),
    uniqueIndex("treatment_plan_conversions_procedure_uq").on(t.performedProcedureId),
    index("treatment_plan_conversions_patient_idx").on(t.organizationId, t.patientId, t.createdAt),
  ],
);
