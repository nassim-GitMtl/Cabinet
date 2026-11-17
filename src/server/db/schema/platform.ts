import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt } from "./_shared";

// ---------------------------------------------------------------------------
// Platform level (not tenant-scoped). Contains no clinical data.
// ---------------------------------------------------------------------------

export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const platformRole = pgEnum("platform_role", ["none", "operator"]);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    locale: text("locale").notNull().default("fr"),
    status: userStatus("status").notNull().default("active"),
    /** Platform operators administer tenants; this grants NO patient-data access. */
    platformRole: platformRole("platform_role").notNull().default("none"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 hex of the opaque token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    activeOrganizationId: uuid("active_organization_id").references(
      () => organizations.id,
    ),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Organization (tenant) boundary
// ---------------------------------------------------------------------------

export const organizationKind = pgEnum("organization_kind", [
  "solo",
  "group",
  "specialist",
  "pediatric",
  "multi_branch",
]);
export const organizationStatus = pgEnum("organization_status", [
  "onboarding",
  "active",
  "suspended",
  "closed",
]);
export const verificationStatus = pgEnum("verification_status", [
  "unverified",
  "pending",
  "verified",
  "rejected",
]);

export type OrganizationSettings = {
  /** Display symbol for the default currency, e.g. "DA" for DZD. */
  currencyDisplay?: string;
  dateFormat?: "DD/MM/YYYY";
  /** Max discount (basis points) a user with price.override may apply without approval. */
  discountLimitBp?: number;
};

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  kind: organizationKind("kind").notNull().default("solo"),
  status: organizationStatus("status").notNull().default("onboarding"),
  /** Unverified organizations may not request access to shared patient profiles. */
  verificationStatus: verificationStatus("verification_status")
    .notNull()
    .default("unverified"),
  countryCode: text("country_code").notNull().default("DZ"),
  defaultLocale: text("default_locale").notNull().default("fr"),
  defaultCurrency: text("default_currency").notNull().default("DZD"),
  timezone: text("timezone").notNull().default("Africa/Algiers"),
  enabledModules: text("enabled_modules")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  settings: jsonb("settings").$type<OrganizationSettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const legalEntities = pgTable("legal_entities", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  legalName: text("legal_name").notNull(),
  /** Country-specific identifiers (e.g. NIF, NIS, RC, AI in Algeria). Configurable, not assumed. */
  identifiers: jsonb("identifiers").$type<Record<string, string>>().notNull().default({}),
  address: text("address"),
  currency: text("currency").notNull().default("DZD"),
  invoicePrefix: text("invoice_prefix").notNull().default("F"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

export const branches = pgTable("branches", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  legalEntityId: uuid("legal_entity_id")
    .notNull()
    .references(() => legalEntities.id),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  timezone: text("timezone").notNull().default("Africa/Algiers"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_org_key_uq").on(t.organizationId, t.key)],
);

export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "active",
  "deactivated",
]);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: membershipStatus("status").notNull().default("active"),
    displayName: text("display_name").notNull(),
    /** Professional title shown on documents, e.g. "Dr". */
    title: text("title"),
    isProvider: boolean("is_provider").notNull().default(false),
    /** null = all branches of the organization. */
    branchIds: uuid("branch_ids").array(),
    createdAt: createdAt(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

/** Concurrency-safe per-tenant sequences (patient numbers, invoice numbers...). */
export const counters = pgTable(
  "counters",
  {
    organizationId: organizationId().references(() => organizations.id),
    scope: text("scope").notNull(),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.scope] })],
);

// ---------------------------------------------------------------------------
// Audit trail: append-only (UPDATE/DELETE are not granted to the app role).
// ---------------------------------------------------------------------------

export const actorType = pgEnum("actor_type", ["staff", "patient", "system", "platform"]);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    /** null only for platform-level events (e.g. failed login for unknown org). */
    organizationId: uuid("organization_id"),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    patientId: uuid("patient_id"),
    ipAddress: text("ip_address"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_org_time_idx").on(t.organizationId, t.occurredAt),
    index("audit_entity_idx").on(t.entityType, t.entityId),
  ],
);
