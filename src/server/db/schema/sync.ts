import { sql } from "drizzle-orm";
import { bigint, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { organizations, users } from "./platform";

/** PostgreSQL 64-bit transaction id (compared numerically; read as a string). */
const xid8 = customType<{ data: string; driverData: string }>({ dataType: () => "xid8" });

// ---------------------------------------------------------------------------
// Offline clinic computer <-> cloud copy. Change capture, apply bookkeeping and
// node pairing. None of these tables is itself replicated.
// ---------------------------------------------------------------------------

/**
 * Change log written by the `sync_capture` trigger for clinics whose data lives on a clinic computer.
 * Append-only. `txid` lets readers take only finished transactions (see src/server/sync/changes.ts).
 */
export const syncChanges = pgTable("sync_changes", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  organizationId: organizationId().references(() => organizations.id),
  txid: xid8("txid").notNull().default(sql`pg_current_xact_id()`),
  /** "clinic" or "cloud": the node where the change happened. */
  origin: text("origin").notNull(),
  tableName: text("table_name").notNull(),
  op: text("op").$type<"upsert" | "delete">().notNull(),
  pk: jsonb("pk").$type<Record<string, unknown>>().notNull(),
  rowData: jsonb("row_data").$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
}, (t) => [index("sync_changes_read_idx").on(t.organizationId, t.origin, t.txid, t.id)]);

/** Last change applied to each row, per origin: an older change never overwrites a newer one. */
export const syncRowVersions = pgTable("sync_row_versions", {
  organizationId: organizationId().references(() => organizations.id),
  tableName: text("table_name").notNull(),
  pk: text("pk").notNull(),
  origin: text("origin").notNull(),
  changeId: bigint("change_id", { mode: "number" }).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.tableName, t.pk] })]);

/** Changes that arrived before a row they depend on; retried on every apply. */
export const syncPending = pgTable("sync_pending", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  origin: text("origin").notNull(),
  changeId: bigint("change_id", { mode: "number" }).notNull(),
  tableName: text("table_name").notNull(),
  op: text("op").$type<"upsert" | "delete">().notNull(),
  pk: jsonb("pk").$type<Record<string, unknown>>().notNull(),
  rowData: jsonb("row_data").$type<Record<string, unknown> | null>(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sync_pending_change_uq").on(t.organizationId, t.origin, t.changeId)]);

/**
 * Cloud side: the clinic computer paired with a clinic. The pairing code is short-lived and single-use;
 * it is exchanged for a long-lived node key. Only SHA-256 hashes are stored.
 */
export const syncNodes = pgTable("sync_nodes", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  label: text("label").notNull(),
  pairingCodeHash: text("pairing_code_hash"),
  pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
  nodeKeyHash: text("node_key_hash"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
  pairedAt: timestamp("paired_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("sync_nodes_pairing_uq").on(t.pairingCodeHash),
  uniqueIndex("sync_nodes_key_uq").on(t.nodeKeyHash),
  uniqueIndex("sync_nodes_active_uq").on(t.organizationId).where(sql`revoked_at IS NULL`),
]);
