// Sync engine: read captured changes, apply them on the other copy, export a full first copy.
// Runs on a connection logged in as `cabinet_sync` (row-level security still applies: every transaction sets
// the clinic context first). No server-only imports: used by the cloud routes and the clinic computer worker.
import type postgres from "postgres";
import {
  changeBytes, MAX_BATCH_BYTES, orderTables, START_CURSOR,
  type SyncChange, type SyncCursor, type SyncOrigin,
} from "./types";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

async function setClinic(tx: Tx, organizationId: string) {
  await tx`select set_config('app.org_id', ${organizationId}, true), set_config('app.actor_type', 'system', true),
                  set_config('app.user_id', '', true), set_config('app.network_patient_id', '', true)`;
}

// ---------------------------------------------------------------------------
// Reading the change log
// ---------------------------------------------------------------------------

/**
 * Next changes recorded on this copy for one clinic and origin, in order, cut at ~MAX_BATCH_BYTES.
 * Only finished transactions are returned; the returned cursor resumes exactly after the last change.
 */
export async function readChanges(
  sql: Sql, organizationId: string, origin: SyncOrigin, cursor: SyncCursor = START_CURSOR, limit = 500,
): Promise<{ changes: SyncChange[]; cursor: SyncCursor; more: boolean }> {
  return sql.begin(async (tx) => {
    await setClinic(tx, organizationId);
    let to = cursor.to;
    if (to === null) {
      const [row] = await tx<{ xmin: string }[]>`
        select greatest(pg_snapshot_xmin(pg_current_snapshot()), ${cursor.from}::xid8)::text as xmin`;
      to = row!.xmin;
    }
    const rows = await tx<{ id: string; table_name: string; op: "upsert" | "delete"; pk: string; row_data: string | null }[]>`
      select id, table_name, op, pk::text as pk, row_data::text as row_data
        from public.sync_changes
       where organization_id = ${organizationId} and origin = ${origin}
         and txid >= ${cursor.from}::xid8 and txid < ${to}::xid8 and id > ${cursor.after}
       order by id
       limit ${limit}`;
    const changes: SyncChange[] = [];
    let bytes = 0;
    for (const r of rows) {
      const change: SyncChange = { id: Number(r.id), table: r.table_name, op: r.op, pk: r.pk, row: r.row_data };
      if (changes.length && bytes + changeBytes(change) > MAX_BATCH_BYTES) break;
      changes.push(change);
      bytes += changeBytes(change);
    }
    const cut = changes.length < rows.length || rows.length === limit;
    const next: SyncCursor = cut
      ? { from: cursor.from, to, after: changes.at(-1)?.id ?? cursor.after }
      : { from: to, to: null, after: 0 };
    return { changes, cursor: next, more: cut };
  });
}

// ---------------------------------------------------------------------------
// Applying changes from the other copy
// ---------------------------------------------------------------------------

export type ApplyResult = { applied: number; skipped: number; pending: number };
type Outcome = "applied" | "skipped" | "waiting";

const FK_VIOLATION = "23503";

async function applyOne(tx: Tx, organizationId: string, origin: SyncOrigin, change: SyncChange): Promise<Outcome> {
  const [version] = await tx<{ origin: string; change_id: string }[]>`
    select origin, change_id from public.sync_row_versions
     where organization_id = ${organizationId} and table_name = ${change.table} and pk = ${change.pk}`;
  // Same origin, already at this change or newer: an older change never overwrites a newer one.
  if (version && version.origin === origin && Number(version.change_id) >= change.id && change.id > 0) return "skipped";
  try {
    await tx.savepoint(async (sp) => {
      if (change.table === "consent_grants" && change.row) {
        // Consent decisions are the patient's own records: apply them in that patient's context.
        const networkPatientId = (JSON.parse(change.row) as { network_patient_id?: string }).network_patient_id ?? "";
        await sp`select set_config('app.actor_type', 'patient', true), set_config('app.network_patient_id', ${networkPatientId}, true)`;
      }
      await sp`select app_private.sync_apply_row(${change.table}, ${change.op}, ${change.pk}::text::jsonb, ${change.row}::text::jsonb)`;
      if (change.table === "consent_grants") {
        await sp`select set_config('app.actor_type', 'system', true), set_config('app.network_patient_id', '', true)`;
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === FK_VIOLATION) return "waiting";
    throw error;
  }
  await tx`
    insert into public.sync_row_versions (organization_id, table_name, pk, origin, change_id)
    values (${organizationId}, ${change.table}, ${change.pk}, ${origin}, ${change.id})
    on conflict (organization_id, table_name, pk)
      do update set origin = excluded.origin, change_id = excluded.change_id, applied_at = now()`;
  return "applied";
}

/**
 * Applies changes coming from `origin`, in one transaction. A row whose parent has not arrived yet waits in
 * `sync_pending` and is retried after every later batch. Business triggers are skipped (the rows were checked
 * where they were written); row-level security still applies.
 */
export async function applyChanges(sql: Sql, organizationId: string, origin: SyncOrigin, changes: SyncChange[]): Promise<ApplyResult> {
  return sql.begin(async (tx) => {
    await setClinic(tx, organizationId);
    await tx`select set_config('app.sync_apply', 'on', true)`;
    const stored = await tx<{ change_id: string; table_name: string; op: "upsert" | "delete"; pk: string; row_data: string | null }[]>`
      select change_id, table_name, op, pk::text as pk, row_data::text as row_data
        from public.sync_pending where organization_id = ${organizationId} and origin = ${origin}
       order by change_id, created_at`;
    const result: ApplyResult = { applied: 0, skipped: 0, pending: 0 };
    let waiting: SyncChange[] = [];
    for (const change of changes) {
      const outcome = await applyOne(tx, organizationId, origin, change);
      if (outcome === "waiting") waiting.push(change);
      else result[outcome] += 1;
    }
    // Retry everything waiting (earlier batches first) until a pass makes no progress.
    waiting = [...stored.map((r) => ({ id: Number(r.change_id), table: r.table_name, op: r.op, pk: r.pk, row: r.row_data })), ...waiting];
    let progress = true;
    while (waiting.length && progress) {
      progress = false;
      const still: SyncChange[] = [];
      for (const change of waiting) {
        const outcome = await applyOne(tx, organizationId, origin, change);
        if (outcome === "waiting") still.push(change);
        else { progress = true; result[outcome] += 1; }
      }
      waiting = still;
    }
    await tx`delete from public.sync_pending where organization_id = ${organizationId} and origin = ${origin}`;
    for (const change of waiting) {
      await tx`
        insert into public.sync_pending (organization_id, origin, change_id, table_name, op, pk, row_data, attempts, last_error)
        values (${organizationId}, ${origin}, ${change.id}, ${change.table}, ${change.op}, ${change.pk}::text::jsonb, ${change.row}::text::jsonb, 1, 'waiting for a related record')
        on conflict (organization_id, origin, change_id) do update set attempts = public.sync_pending.attempts + 1`;
    }
    result.pending = waiting.length;
    return result;
  });
}

// ---------------------------------------------------------------------------
// First full copy (a new clinic computer downloads everything once)
// ---------------------------------------------------------------------------

/** Replicated tables, parents first, plus the shared patient identities they point to. */
export async function snapshotTables(sql: Sql): Promise<string[]> {
  const [{ tables }] = await sql<{ tables: string[] }[]>`select app_private.sync_tables() as tables`;
  const all = ["network_patients", ...tables];
  const refs = await sql<{ child: string; parent: string }[]>`
    select c.relname::text as child, p.relname::text as parent
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_class p on p.oid = k.confrelid
      join pg_namespace n on n.oid = c.relnamespace
     where k.contype = 'f' and n.nspname = 'public'`;
  // The clinic itself first: every other row (and the sync bookkeeping) points to it.
  return ["organizations", ...orderTables(all, refs).filter((t) => t !== "organizations")];
}

const ORG_FILTER: Record<string, string> = {
  organizations: "t.id = $1",
  users: "t.id in (select m.user_id from public.memberships m where m.organization_id = $1)",
  consent_requests: "t.requesting_organization_id = $1",
  consent_grants: "t.receiving_organization_id = $1",
  network_patients: `t.id in (
    select network_patient_id from public.patients where organization_id = $1 and network_patient_id is not null
    union select network_patient_id from public.patient_identity_links where organization_id = $1
    union select network_patient_id from public.consent_requests where requesting_organization_id = $1
    union select network_patient_id from public.consent_grants where receiving_organization_id = $1)`,
};

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * One page of a table's rows for a clinic, ordered by primary key, as changes with id 0 (a later change of the
 * same row always wins). `after` is the last primary key returned (JSON text), null to start.
 */
export async function exportSnapshotPage(
  sql: Sql, organizationId: string, table: string, after: string | null, limit = 300,
): Promise<{ changes: SyncChange[]; after: string | null; done: boolean }> {
  const tables = await snapshotTables(sql);
  if (!tables.includes(table)) throw new Error(`snapshot: table ${table} is not replicated`);
  return sql.begin(async (tx) => {
    await setClinic(tx, organizationId);
    const pkCols = (await tx<{ name: string }[]>`
      select a.attname::text as name from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
       where i.indrelid = format('public.%I', ${table}::text)::regclass and i.indisprimary
       order by a.attnum`).map((r) => r.name);
    const rel = `public.${quoteIdent(table)}`;
    const pkList = pkCols.map((c) => `t.${quoteIdent(c)}`).join(", ");
    const filter = ORG_FILTER[table] ?? "t.organization_id = $1";
    const afterClause = after === null ? "" : ` and (${pkList}) > (select ${pkCols.map((c) => `a.${quoteIdent(c)}`).join(", ")} from jsonb_populate_record(null::${rel}, $3::text::jsonb) a)`;
    const rows = await tx.unsafe<{ pk: string; row: string }[]>(
      `select app_private.sync_pk($2::text, to_jsonb(t))::text as pk, to_jsonb(t)::text as row
         from ${rel} t where ${filter}${afterClause}
        order by ${pkList} limit ${Number(limit)}`,
      after === null ? [organizationId, table] : [organizationId, table, after],
    );
    const changes: SyncChange[] = [];
    let bytes = 0;
    for (const r of rows) {
      const change: SyncChange = { id: 0, table, op: "upsert", pk: r.pk, row: r.row };
      if (changes.length && bytes + changeBytes(change) > MAX_BATCH_BYTES) break;
      changes.push(change);
      bytes += changeBytes(change);
    }
    const done = changes.length === rows.length && rows.length < limit;
    return { changes, after: changes.at(-1)?.pk ?? after, done };
  });
}

/** True once every transaction that started before the pairing has finished (safe to read a full copy). */
export async function snapshotReady(sql: Sql, waitFor: string): Promise<boolean> {
  const [row] = await sql<{ ready: boolean }[]>`select pg_snapshot_xmin(pg_current_snapshot()) >= ${waitFor}::xid8 as ready`;
  return row!.ready;
}

/** Highest transaction id that may have started before now; used right after pairing. */
export async function currentXmax(sql: Sql): Promise<string> {
  const [row] = await sql<{ xmax: string }[]>`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`;
  return row!.xmax;
}
