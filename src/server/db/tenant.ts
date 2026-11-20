import "server-only";
import { sql } from "drizzle-orm";
import { db, type Database, type Tx } from "./client";

export type ActorType = "staff" | "patient" | "system";

export type DbContext = {
  organizationId?: string | null;
  userId?: string | null;
  actorType: ActorType;
  networkPatientId?: string | null;
};

/**
 * Runs `fn` in a transaction whose PostgreSQL settings carry the tenant
 * context. RLS policies read these settings, so a query issued here can only
 * see rows of `organizationId`. Settings are transaction-local (`is_local =
 * true`), which keeps pooled connections safe.
 *
 * All tenant data access MUST go through this function (or withTenant).
 */
export async function withDbContext<T>(
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  database: Database = db,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.org_id', ${ctx.organizationId ?? ""}, true),
      set_config('app.user_id', ${ctx.userId ?? ""}, true),
      set_config('app.actor_type', ${ctx.actorType}, true),
      set_config('app.network_patient_id', ${ctx.networkPatientId ?? ""}, true)`);
    return fn(tx);
  });
}

/** Re-scopes an open transaction (used when an organization is created mid-transaction). */
export async function setTxOrganization(tx: Tx, organizationId: string) {
  await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
}

/** Allocates the next value of a per-tenant counter under a row lock. */
/** Reserves `count` consecutive numbers at once (bulk imports); returns the first one. */
export async function reserveCounterBlock(tx: Tx, organizationId: string, scope: string, count: number): Promise<number> {
  if (!Number.isInteger(count) || count < 1) throw new Error("reserveCounterBlock: count must be a positive integer");
  const rows = await tx.execute<{ value: string }>(sql`
    insert into counters (organization_id, scope, next_value)
    values (${organizationId}, ${scope}, ${count + 1})
    on conflict (organization_id, scope)
      do update set next_value = counters.next_value + ${count}
    returning next_value - ${count} as value`);
  return Number(rows[0]!.value);
}

export async function nextCounter(tx: Tx, organizationId: string, scope: string): Promise<number> {
  const rows = await tx.execute<{ value: string }>(sql`
    insert into counters (organization_id, scope, next_value)
    values (${organizationId}, ${scope}, 2)
    on conflict (organization_id, scope)
      do update set next_value = counters.next_value + 1
    returning next_value - 1 as value`);
  return Number(rows[0]!.value);
}
