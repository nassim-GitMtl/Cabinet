import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt } from "./_shared";
import { networkPatients, patients } from "./patients";
import { organizations, users } from "./platform";

export const patientAccountStatus = pgEnum("patient_account_status", ["active", "disabled"]);
export const portalInvitationKind = pgEnum("portal_invitation_kind", ["activation", "recovery"]);

/** Global patient login, deliberately separate from staff users. */
export const patientAccounts = pgTable("patient_accounts", {
  id: id(),
  networkPatientId: uuid("network_patient_id").notNull().references(() => networkPatients.id),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  locale: text("locale").notNull().default("fr"),
  status: patientAccountStatus("status").notNull().default("active"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("patient_accounts_network_uq").on(t.networkPatientId),
  uniqueIndex("patient_accounts_email_lower_uq").on(sql`lower(${t.email})`),
]);

export const patientSessions = pgTable("patient_sessions", {
  id: text("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => patientAccounts.id),
  networkPatientId: uuid("network_patient_id").notNull().references(() => networkPatients.id),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("patient_sessions_account_idx").on(t.accountId, t.expiresAt)]);

/** Tenant-owned, single-use activation handoff after an assisted identity check. */
export const portalInvitations = pgTable("portal_invitations", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  networkPatientId: uuid("network_patient_id").notNull().references(() => networkPatients.id),
  email: text("email").notNull(),
  kind: portalInvitationKind("kind").notNull().default("activation"),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("portal_invitations_token_uq").on(t.tokenHash),
  index("portal_invitations_patient_idx").on(t.organizationId, t.patientId, t.createdAt),
]);
