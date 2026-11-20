import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { ACQUISITION_CHANNELS } from "../../../lib/acquisition";
import {
  boolean,
  date,
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
import { memberships, organizations, users } from "./platform";

// ---------------------------------------------------------------------------
// Network identity: a stable private identity that is NOT tenant-scoped.
// A clinic patient record is linked to it only through verified evidence
// (patient_identity_links). Never matched on name/phone/birth date alone.
// ---------------------------------------------------------------------------

export const networkPatientStatus = pgEnum("network_patient_status", [
  "active",
  "merged",
  "closed",
]);

export const networkPatients = pgTable("network_patients", {
  id: id(),
  status: networkPatientStatus("status").notNull().default("active"),
  mergedIntoId: uuid("merged_into_id"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Clinic patient registration (tenant-private)
// ---------------------------------------------------------------------------

export const patientStatus = pgEnum("patient_status", [
  "active",
  "inactive",
  "archived",
  "deceased",
]);
export const birthDatePrecision = pgEnum("birth_date_precision", [
  "exact",
  "year",
  "estimated",
]);
/** How a new patient heard of the clinic (§6, §19): drives the acquisition report. */
export const acquisitionChannel = pgEnum("acquisition_channel", ACQUISITION_CHANNELS);

export const patientSex = pgEnum("patient_sex", ["female", "male", "other", "undisclosed"]);

export type EmergencyContact = { name: string; relationship?: string; phone?: string };
export type CommunicationPrefs = {
  channels?: Array<"sms" | "whatsapp" | "email" | "phone">;
  transactionalAllowed?: boolean;
  /** Marketing is opt-in only, with timestamp evidence. */
  marketingOptInAt?: string | null;
  marketingOptOutAt?: string | null;
};

export const patients = pgTable(
  "patients",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientNumber: text("patient_number").notNull(),
    /** Set only after a verified identity link; null = clinic-local only. */
    networkPatientId: uuid("network_patient_id").references(() => networkPatients.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    firstNameAr: text("first_name_ar"),
    lastNameAr: text("last_name_ar"),
    sex: patientSex("sex"),
    birthDate: date("birth_date", { mode: "string" }),
    birthDatePrecision: birthDatePrecision("birth_date_precision"),
    /** E.164 normalized. */
    phone: text("phone"),
    phoneAlt: text("phone_alt"),
    email: text("email"),
    addressLine: text("address_line"),
    city: text("city"),
    region: text("region"),
    preferredLocale: text("preferred_locale").notNull().default("fr"),
    emergencyContact: jsonb("emergency_contact").$type<EmergencyContact | null>(),
    communicationPrefs: jsonb("communication_prefs")
      .$type<CommunicationPrefs>()
      .notNull()
      .default({}),
    assignedProviderId: uuid("assigned_provider_id").references(() => memberships.id),
    acquisitionChannel: acquisitionChannel("acquisition_channel"),
    /** Free-text detail of the source (e.g. "page Facebook", "salon de Blida"). */
    referralSource: text("referral_source"),
    /** Referring practitioner (free text). */
    referredBy: text("referred_by"),
    /** Patient of this clinic who recommended them (same clinic, never self; DB guard). */
    referredByPatientId: uuid("referred_by_patient_id").references((): AnyPgColumn => patients.id),
    /** File number from the clinic's previous system or paper records (searchable, not unique). */
    legacyNumber: text("legacy_number"),
    /** Import batch that created this patient, if any. */
    importId: uuid("import_id").references((): AnyPgColumn => patientImports.id),
    /** Administrative only. Clinical content never goes here. */
    administrativeNotes: text("administrative_notes"),
    status: patientStatus("status").notNull().default("active"),
    deceasedAt: date("deceased_at", { mode: "string" }),
    /** Accent-insensitive search haystack (see migration 0000 for f_unaccent). */
    searchText: text("search_text").generatedAlwaysAs(
      (): SQL =>
        sql`public.f_unaccent(lower(coalesce(${patients.firstName}, '') || ' ' || coalesce(${patients.lastName}, '') || ' ' || coalesce(${patients.firstNameAr}, '') || ' ' || coalesce(${patients.lastNameAr}, '') || ' ' || ${patients.patientNumber} || ' ' || coalesce(${patients.phone}, '') || ' ' || coalesce(${patients.phoneAlt}, '')))`,
    ),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex("patients_org_number_uq").on(t.organizationId, t.patientNumber),
    index("patients_org_phone_idx").on(t.organizationId, t.phone),
    index("patients_org_created_idx").on(t.organizationId, t.createdAt),
    index("patients_referrer_idx").on(t.organizationId, t.referredByPatientId),
    index("patients_legacy_number_idx").on(t.organizationId, t.legacyNumber),
    index("patients_search_trgm_idx").using("gin", sql`${t.searchText} gin_trgm_ops`),
  ],
);

/** Clinician-entered alerts. Never mixed with marketing labels. */
export const alertSeverity = pgEnum("alert_severity", ["info", "warning", "critical"]);
export const alertKind = pgEnum("alert_kind", ["medical", "allergy", "medication", "administrative"]);

export const patientAlerts = pgTable(
  "patient_alerts",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    kind: alertKind("kind").notNull(),
    severity: alertSeverity("severity").notNull().default("warning"),
    label: text("label").notNull(),
    details: text("details"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
  },
  (t) => [index("patient_alerts_patient_idx").on(t.patientId)],
);

/** Guardian / representative / family / responsible payer. No implied record sharing. */
export const patientRelationships = pgTable(
  "patient_relationships",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    relatedPatientId: uuid("related_patient_id").references(() => patients.id),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    relationship: text("relationship").notNull(),
    isLegalRepresentative: boolean("is_legal_representative").notNull().default(false),
    authorityEvidence: text("authority_evidence"),
    isResponsiblePayer: boolean("is_responsible_payer").notNull().default(false),
    validFrom: date("valid_from", { mode: "string" }),
    validUntil: date("valid_until", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [index("patient_relationships_patient_idx").on(t.patientId)],
);

/** Verified evidence linking a clinic patient record to a network identity. */
export const identityLinkMethod = pgEnum("identity_link_method", [
  "patient_account_claim",
  "patient_qr",
  "assisted_in_person",
]);
export const identityLinkStatus = pgEnum("identity_link_status", ["active", "revoked"]);

export const patientIdentityLinks = pgTable(
  "patient_identity_links",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    networkPatientId: uuid("network_patient_id")
      .notNull()
      .references(() => networkPatients.id),
    method: identityLinkMethod("method").notNull(),
    evidenceRef: text("evidence_ref"),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    status: identityLinkStatus("status").notNull().default("active"),
  },
  (t) => [
    uniqueIndex("identity_links_org_patient_uq")
      .on(t.organizationId, t.patientId)
      .where(sql`status = 'active'`),
  ],
);

/** One import of an existing patient list (history; append-only). Rows themselves are never stored. */
export const patientImports = pgTable(
  "patient_imports",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    totalRows: integer("total_rows").notNull(),
    importedCount: integer("imported_count").notNull(),
    skippedDuplicates: integer("skipped_duplicates").notNull(),
    skippedInvalid: integer("skipped_invalid").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("patient_imports_org_idx").on(t.organizationId, t.createdAt)],
);
