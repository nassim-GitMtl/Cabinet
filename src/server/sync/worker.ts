// Background sync on the clinic computer: first full copy, then send local changes and fetch the cloud's.
// Started from src/instrumentation.ts; does nothing on the cloud copy. No server-only imports.
import type postgres from "postgres";
import { cloudClient, normalizeCloudUrl, SyncHttpError, syncErrorCode, type FetchLike } from "./client";
import { syncSql } from "./connection";
import { applyChanges, readChanges, snapshotTables } from "./engine";
import { protectNodeKey, revealNodeKey } from "./secret";
import { START_CURSOR, type SyncCursor } from "./types";

type Sql = postgres.Sql;
type NodeRow = {
  node_role: string; state: "unpaired" | "bootstrapping" | "active"; organization_id: string | null; cloud_url: string | null;
  node_key_enc: string | null; push_cursor: SyncCursor | null; pull_cursor: SyncCursor | null;
  bootstrap_progress: { index?: number; after?: string | null; total?: number } | null;
};
export type SyncRun = { state: string; pushed: number; pulled: number; error: string | null };

const WORKER_LOCK = 734_221_905; // pg advisory lock: one worker at a time per clinic computer

/**
 * Pairs a fresh clinic computer with the cloud copy (single-use code from the cloud's settings). Any login may call
 * it: `begin_clinic_node` refuses unless this is an unpaired clinic computer with no clinic created yet.
 */
export async function pairWithCloud(sql: Sql, rawUrl: string, code: string, fetchImpl: FetchLike = fetch) {
  const url = normalizeCloudUrl(rawUrl);
  if (!url) throw new SyncHttpError(400, "invalidUrl");
  const claim = await cloudClient(url, null, fetchImpl).pair(code);
  await sql`select app_private.begin_clinic_node(${claim.organizationId}::uuid, ${url}, ${protectNodeKey(claim.nodeKey)}, ${claim.pullFrom})`;
  return { organizationId: claim.organizationId };
}

async function save(sql: Sql, patch: Record<string, unknown>) {
  const sets = Object.keys(patch);
  if (!sets.length) return;
  await sql`update app_private.node_settings set ${sql(patch as Record<string, postgres.ParameterOrJSON<never>>, ...sets)}, updated_at = now() where singleton`;
}

/** One pass: bootstrap (resumable) or push + pull, within `budgetMs`. Errors are recorded, never thrown. */
export async function runSyncOnce(sql: Sql, fetchImpl: FetchLike = fetch, budgetMs = 20_000): Promise<SyncRun> {
  const reserved = await sql.reserve();
  try {
    const [{ locked }] = await reserved<{ locked: boolean }[]>`select pg_try_advisory_lock(${WORKER_LOCK}) as locked`;
    if (!locked) return { state: "busy", pushed: 0, pulled: 0, error: null };
    try {
      return await runLocked(sql, fetchImpl, Date.now() + budgetMs);
    } finally {
      await reserved`select pg_advisory_unlock(${WORKER_LOCK})`;
    }
  } finally {
    reserved.release();
  }
}

async function runLocked(sql: Sql, fetchImpl: FetchLike, deadline: number): Promise<SyncRun> {
  const [node] = await sql<NodeRow[]>`
    select node_role, state, organization_id, cloud_url, node_key_enc, push_cursor, pull_cursor, bootstrap_progress
      from app_private.node_settings where singleton`;
  const result: SyncRun = { state: node?.state ?? "unpaired", pushed: 0, pulled: 0, error: null };
  if (!node || node.node_role !== "clinic" || node.state === "unpaired" || !node.organization_id || !node.cloud_url || !node.node_key_enc) return result;
  const org = node.organization_id;
  const client = cloudClient(node.cloud_url, revealNodeKey(node.node_key_enc), fetchImpl);
  try {
    if (node.state === "bootstrapping") {
      const tables = await snapshotTables(sql);
      let index = node.bootstrap_progress?.index ?? 0;
      let after = node.bootstrap_progress?.after ?? null;
      const waitFor = node.pull_cursor?.from ?? "0";
      while (index < tables.length && Date.now() < deadline) {
        let page;
        try {
          page = await client.snapshot(tables[index]!, after, waitFor);
        } catch (error) {
          if (error instanceof SyncHttpError && error.code === "notReady") return result; // try again shortly
          throw error;
        }
        if (page.changes.length) await applyChanges(sql, org, "cloud", page.changes);
        if (page.done) { index += 1; after = null; } else after = page.after;
        await save(sql, { bootstrap_progress: sql.json({ index, after, total: tables.length }) });
      }
      if (index < tables.length) return result;
      await save(sql, { state: "active", push_cursor: sql.json(START_CURSOR), bootstrap_progress: sql.json({ index, total: tables.length, done: true }) });
      result.state = "active";
    }

    let push = node.push_cursor ?? START_CURSOR;
    for (;;) {
      const page = await readChanges(sql, org, "clinic", push);
      if (page.changes.length) await client.push(page.changes);
      result.pushed += page.changes.length;
      push = page.cursor;
      await save(sql, { push_cursor: sql.json(push), last_push_at: new Date() });
      if (!page.more || Date.now() > deadline) break;
    }

    let pull = node.pull_cursor ?? START_CURSOR;
    for (;;) {
      const page = await client.pull(pull);
      if (page.changes.length) await applyChanges(sql, org, "cloud", page.changes);
      result.pulled += page.changes.length;
      pull = page.cursor;
      await save(sql, { pull_cursor: sql.json(pull), last_pull_at: new Date() });
      if (!page.more || Date.now() > deadline) break;
    }
    await save(sql, { last_error: null, last_error_at: null });
  } catch (error) {
    result.error = syncErrorCode(error);
    await save(sql, { last_error: result.error, last_error_at: new Date() }).catch(() => {});
  }
  return result;
}

const worker = globalThis as unknown as { __cabinetSyncWorker?: { timer: ReturnType<typeof setInterval>; kick: () => void } };

/** Starts the 15-second loop on a clinic computer (checks the node role once; idle on the cloud copy). */
export async function startSyncWorker(intervalMs = 15_000) {
  if (worker.__cabinetSyncWorker) return;
  const sql = syncSql();
  const [row] = await sql<{ role: string }[]>`select app_private.node_role() as role`;
  if (row?.role !== "clinic") return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runSyncOnce(sql).catch(() => {}).finally(() => { running = false; });
  };
  worker.__cabinetSyncWorker = { timer: setInterval(tick, intervalMs), kick: tick };
  setTimeout(tick, 2_000);
}

/** Runs a pass now (after pairing), if the loop is running in this process. */
export function kickSyncWorker() {
  worker.__cabinetSyncWorker?.kick();
}
