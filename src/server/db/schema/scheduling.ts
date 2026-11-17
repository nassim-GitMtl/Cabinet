import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt, version, type LocalizedText } from "./_shared";
import { patients } from "./patients";
import { branches, memberships, organizations, users } from "./platform";

/** Dental chairs / rooms used as schedulable resources. */
export const chairs = pgTable("chairs", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const appointmentTypes = pgTable(
  "appointment_types",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    code: text("code").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    defaultDurationMin: integer("default_duration_min").notNull().default(30),
    color: text("color").notNull().default("teal"),
    isBookableOnline: boolean("is_bookable_online").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("appointment_types_org_code_uq").on(t.organizationId, t.code)],
);

/** Recurring weekly working hours (ISO weekday 1 = Monday … 7 = Sunday). Gaps are breaks. */
export const workingHours = pgTable(
  "working_hours",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => memberships.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    index("working_hours_provider_idx").on(t.organizationId, t.providerId, t.weekday),
    check("working_hours_weekday_valid", sql`${t.weekday} between 1 and 7`),
    check("working_hours_order", sql`${t.endTime} > ${t.startTime}`),
  ],
);

export const timeOffKind = pgEnum("time_off_kind", ["leave", "holiday", "blocked"]);

/** Leave, public holidays (provider null = whole clinic) and blocked slots. */
export const timeOff = pgTable(
  "time_off",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    providerId: uuid("provider_id").references(() => memberships.id),
    kind: timeOffKind("kind").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("time_off_range_idx").on(t.organizationId, t.startsAt), check("time_off_order", sql`${t.endsAt} > ${t.startsAt}`)],
);

// Three independent state dimensions (§9): scheduling, confirmation, visit.
export const schedulingStatus = pgEnum("scheduling_status", ["requested", "booked", "cancelled", "no_show"]);
export const confirmationStatus = pgEnum("confirmation_status", ["pending", "confirmed", "declined", "reschedule_requested"]);
export const visitStatus = pgEnum("visit_status", ["not_arrived", "arrived", "waiting", "in_treatment", "completed"]);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => memberships.id),
    chairId: uuid("chair_id").references(() => chairs.id),
    appointmentTypeId: uuid("appointment_type_id").references(() => appointmentTypes.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    schedulingStatus: schedulingStatus("scheduling_status").notNull().default("booked"),
    confirmationStatus: confirmationStatus("confirmation_status").notNull().default("pending"),
    visitStatus: visitStatus("visit_status").notNull().default("not_arrived"),
    /** Administrative appointment note — never the clinical record. */
    notes: text("notes"),
    cancellationReason: text("cancellation_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    treatmentStartedAt: timestamp("treatment_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    outsideHoursOverride: boolean("outside_hours_override").notNull().default(false),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    index("appointments_org_start_idx").on(t.organizationId, t.startsAt),
    index("appointments_patient_idx").on(t.organizationId, t.patientId, t.startsAt),
    check("appointments_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
