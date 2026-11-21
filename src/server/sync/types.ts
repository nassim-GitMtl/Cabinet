// Protocol between a clinic computer and the cloud copy. Shared by both sides; no server-only imports so the
// clinic computer's background worker can use it too.
import journal from "../../../drizzle/meta/_journal.json";

export type SyncOrigin = "clinic" | "cloud";
export type SyncOp = "upsert" | "delete";

/** One captured change. `pk` and `row` are JSON text exactly as PostgreSQL produced them (no number rounding). */
export type SyncChange = { id: number; table: string; op: SyncOp; pk: string; row: string | null };

/**
 * Read position in a change log. Changes are read by finished-transaction windows: [from, to) holds only
 * transactions that can no longer change, so nothing committed late is skipped. `after` pages inside a window.
 */
export type SyncCursor = { from: string; to: string | null; after: number };
export const START_CURSOR: SyncCursor = { from: "0", to: null, after: 0 };

/** Both copies must run the same database version before exchanging rows. */
export const SCHEMA_VERSION: string = journal.entries.at(-1)!.tag;

/** Keeps request/response bodies well under hosting limits (Vercel functions: 4.5 MB). */
export const MAX_BATCH_BYTES = 2_000_000;

export function isSyncCursor(value: unknown): value is SyncCursor {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  const xid = (v: unknown) => typeof v === "string" && /^\d{1,20}$/.test(v);
  return xid(c.from) && (c.to === null || xid(c.to)) && typeof c.after === "number" && Number.isSafeInteger(c.after) && c.after >= 0;
}

export function isSyncChange(value: unknown): value is SyncChange {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === "number" && Number.isSafeInteger(c.id) && c.id >= 0
    && typeof c.table === "string" && /^[a-z_][a-z0-9_]{0,62}$/.test(c.table)
    && (c.op === "upsert" || c.op === "delete")
    && typeof c.pk === "string" && (c.row === null || typeof c.row === "string")
    && (c.op === "delete" ? c.row === null : c.row !== null);
}

/** Size of a change on the wire (used to cut batches). */
export const changeBytes = (c: SyncChange) => c.pk.length + (c.row?.length ?? 0) + c.table.length + 40;

/**
 * Orders tables so that a table comes after the tables it references (parents first). Self-references and
 * cycles are ignored; rows that still arrive before their parent wait in `sync_pending` and are retried.
 */
export function orderTables(tables: string[], references: { child: string; parent: string }[]): string[] {
  const set = new Set(tables);
  const parents = new Map<string, Set<string>>(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of references) {
    if (child !== parent && set.has(child) && set.has(parent)) parents.get(child)!.add(parent);
  }
  const ordered: string[] = [];
  const placed = new Set<string>();
  const remaining = [...tables].sort();
  while (remaining.length) {
    const ready = remaining.filter((t) => [...parents.get(t)!].every((p) => placed.has(p)));
    // A cycle: place the alphabetically first remaining table and continue.
    const batch = ready.length ? ready : [remaining[0]!];
    for (const t of batch) {
      ordered.push(t);
      placed.add(t);
      remaining.splice(remaining.indexOf(t), 1);
    }
  }
  return ordered;
}
