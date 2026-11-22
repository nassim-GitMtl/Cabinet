import { sql } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt } from "./_shared";
import { acquisitionChannel, patients } from "./patients";
import { memberships, organizations, users } from "./platform";
import { appointments, appointmentTypes } from "./scheduling";

/**
 * Patient self-booking (§9A). A request is NEVER a confirmed appointment:
 * an authorized assistant or dentist must approve it, which re-checks
 * availability transactionally. Submitting a request grants no access to the
 * patient's shared profile.
 */

export const bookingLinks = pgTable(
  "booking_links",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Public, revocable URL token (the clinic shares it on purpose). */
    token: text("token").notNull(),
    label: text("label").notNull(),
    appointmentTypeIds: uuid("appointment_type_ids").array().notNull(),
    /** null = all active clinicians. */
    providerIds: uuid("provider_ids").array(),
    horizonDays: integer("horizon_days").notNull().default(30),
    minNoticeHours: integer("min_notice_hours").notNull().default(12),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("booking_links_token_uq").on(t.token)],
);

export const bookingRequestStatus = pgEnum("booking_request_status", [
  "submitted",
  "under_review",
  "awaiting_information",
  "alternative_proposed",
  "approved",
  "declined",
  "withdrawn",
  "expired",
]);

export const bookingRequests = pgTable(
  "booking_requests",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    linkId: uuid("link_id").references(() => bookingLinks.id),
    status: bookingRequestStatus("status").notNull().default("submitted"),
    /** SHA-256 of the patient's status-page token. */
    refHash: text("ref_hash").notNull(),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email"),
    /** Self-declared; never used to reveal or match records automatically. */
    declaresExistingPatient: boolean("declares_existing_patient").notNull().default(false),
    preferredLocale: text("preferred_locale").notNull().default("fr"),
    /** Optional answer to "Comment nous avez-vous connu ?", copied to the patient on approval. */
    acquisitionChannel: acquisitionChannel("acquisition_channel"),
    appointmentTypeId: uuid("appointment_type_id")
      .notNull()
      .references(() => appointmentTypes.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => memberships.id),
    requestedStartsAt: timestamp("requested_starts_at", { withTimezone: true }).notNull(),
    requestedEndsAt: timestamp("requested_ends_at", { withTimezone: true }).notNull(),
    message: text("message"),
    /** Patient-safe reason shown on the status page. */
    declineReason: text("decline_reason"),
    patientId: uuid("patient_id").references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ipHash: text("ip_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("booking_requests_ref_uq").on(t.refHash),
    index("booking_requests_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    index("booking_requests_phone_idx").on(t.organizationId, t.contactPhone, t.createdAt),
    // At most one approval per request, and an appointment backs at most one request.
    uniqueIndex("booking_requests_appointment_uq").on(t.appointmentId).where(sql`appointment_id is not null`),
  ],
);
