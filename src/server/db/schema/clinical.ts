import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, type LocalizedText } from "./_shared";
import { services } from "./catalog";
import { patients } from "./patients";
import { branches, memberships, organizations, users } from "./platform";

export const encounterStatus = pgEnum("encounter_status", [
  "open",
  "completed",
  "cancelled",
  "entered_in_error",
]);

/** A patient visit. Fast procedure entry creates a completed encounter. */
export const encounters = pgTable(
  "encounters",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    primaryProviderId: uuid("primary_provider_id")
      .notNull()
      .references(() => memberships.id),
    /** Calendar date at the clinic. Never timezone-converted. */
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    status: encounterStatus("status").notNull().default("completed"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("encounters_patient_date_idx").on(t.organizationId, t.patientId, t.serviceDate),
    index("encounters_provider_date_idx").on(t.organizationId, t.primaryProviderId, t.serviceDate),
  ],
);

export const performedProcedureStatus = pgEnum("performed_procedure_status", [
  "completed",
  "reversed",
  "entered_in_error",
]);

export const dentalArch = pgEnum("dental_arch", ["maxillary", "mandibular"]);
export const dentalQuadrant = pgEnum("dental_quadrant", [
  "upper_right",
  "upper_left",
  "lower_left",
  "lower_right",
]);

export type ServiceSnapshot = {
  code: string;
  name: LocalizedText;
  pricingUnit: "procedure" | "tooth" | "surface" | "arch" | "quadrant" | "session" | "item";
  anatomy: "none" | "tooth" | "surface" | "arch" | "quadrant";
  taxRateBp: number | null;
};

/**
 * A completed clinical procedure. Catalog and price fields are snapshots:
 * later catalog changes never rewrite clinical or financial history.
 */
export const performedProcedures = pgTable(
  "performed_procedures",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    serviceSnapshot: jsonb("service_snapshot").$type<ServiceSnapshot>().notNull(),
    toothNumber: text("tooth_number"),
    surfaces: text("surfaces").array().notNull().default(sql`'{}'::text[]`),
    arch: dentalArch("arch"),
    quadrant: dentalQuadrant("quadrant"),
    quantity: integer("quantity").notNull().default(1),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    priceOverrideReason: text("price_override_reason"),
    priceOverrideApprovedByUserId: uuid("price_override_approved_by_user_id").references(
      () => users.id,
    ),
    performingProviderId: uuid("performing_provider_id")
      .notNull()
      .references(() => memberships.id),
    /** Kept on the procedure snapshot as well as its encounter for reporting/invoicing. */
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    status: performedProcedureStatus("status").notNull().default("completed"),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusChangedByUserId: uuid("status_changed_by_user_id").references(() => users.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("performed_procedures_quantity_positive", sql`${t.quantity} > 0`),
    check("performed_procedures_price_nonnegative", sql`${t.unitPriceMinor} >= 0`),
    index("performed_procedures_patient_date_idx").on(
      t.organizationId,
      t.patientId,
      t.serviceDate,
    ),
    index("performed_procedures_encounter_idx").on(t.encounterId),
    index("performed_procedures_service_idx").on(t.organizationId, t.serviceId, t.createdAt),
  ],
);

/** Staff-owned shortcuts used by the reusable service picker. */
export const serviceFavorites = pgTable(
  "service_favorites",
  {
    organizationId: organizationId().references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId, t.serviceId] }),
    index("service_favorites_user_idx").on(t.organizationId, t.userId, t.createdAt),
  ],
);
