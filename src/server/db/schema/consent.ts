import {
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./_shared";
import { networkPatients } from "./patients";
import { organizations, users } from "./platform";

/**
 * Cross-clinic shared-profile authorization.
 *
 * These tables are NOT keyed by organization_id; they have custom RLS policies
 * (migration 0002): a clinic sees only requests/grants where it is the
 * receiving organization; grants can only be INSERTed in a patient context
 * (app.actor_type = 'patient'), so no staff control can approve on the
 * patient's behalf.
 */

export const SHARE_CATEGORIES = [
  "summary",
  "alerts",
  "clinical_notes",
  "chart",
  "treatments",
  "images",
  "documents",
  "financial",
] as const;
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

export const consentRequestStatus = pgEnum("consent_request_status", [
  "requested",
  "awaiting_patient",
  "approved",
  "declined",
  "expired",
  "withdrawn",
]);

export type ConsentScope = {
  categories: ShareCategory[];
  dateFrom?: string | null;
  dateTo?: string | null;
  includeFutureUpdates: boolean;
  branchIds?: string[] | null;
};

export const consentRequests = pgTable(
  "consent_requests",
  {
    id: id(),
    requestingOrganizationId: uuid("requesting_organization_id")
      .notNull()
      .references(() => organizations.id),
    networkPatientId: uuid("network_patient_id")
      .notNull()
      .references(() => networkPatients.id),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id),
    purpose: text("purpose").notNull(),
    requestedScope: jsonb("requested_scope").$type<ConsentScope>().notNull(),
    status: consentRequestStatus("status").notNull().default("requested"),
    /** SHA-256 of the single-use approval link token. */
    tokenHash: text("token_hash").unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("consent_requests_patient_idx").on(t.networkPatientId)],
);

export const consentGrantStatus = pgEnum("consent_grant_status", [
  "active",
  "expired",
  "revoked",
  "superseded",
]);
export const consentApproverType = pgEnum("consent_approver_type", [
  "patient",
  "legal_representative",
]);

export const consentGrants = pgTable(
  "consent_grants",
  {
    id: id(),
    networkPatientId: uuid("network_patient_id")
      .notNull()
      .references(() => networkPatients.id),
    receivingOrganizationId: uuid("receiving_organization_id")
      .notNull()
      .references(() => organizations.id),
    requestId: uuid("request_id").references(() => consentRequests.id),
    approverType: consentApproverType("approver_type").notNull(),
    approverRef: text("approver_ref").notNull(),
    verificationMethod: text("verification_method").notNull(),
    verificationEvidenceRef: text("verification_evidence_ref"),
    purpose: text("purpose").notNull(),
    categories: text("categories").array().$type<ShareCategory[]>().notNull(),
    dateFrom: date("date_from", { mode: "string" }),
    dateTo: date("date_to", { mode: "string" }),
    includeFutureUpdates: boolean("include_future_updates").notNull().default(false),
    branchIds: uuid("branch_ids").array(),
    consentTextVersion: text("consent_text_version").notNull(),
    consentLanguage: text("consent_language").notNull(),
    status: consentGrantStatus("status").notNull().default("active"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    supersededById: uuid("superseded_by_id"),
  },
  (t) => [
    index("consent_grants_lookup_idx").on(t.receivingOrganizationId, t.networkPatientId),
  ],
);

/** Every shared-profile read attempt (allowed or denied). Append-only. */
export const sharedAccessEvents = pgTable(
  "shared_access_events",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    networkPatientId: uuid("network_patient_id")
      .notNull()
      .references(() => networkPatients.id),
    grantId: uuid("grant_id").references(() => consentGrants.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    category: text("category").notNull(),
    purpose: text("purpose"),
    outcome: text("outcome", { enum: ["allowed", "denied"] }).notNull(),
    denyReason: text("deny_reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shared_access_patient_idx").on(t.networkPatientId, t.occurredAt)],
);
