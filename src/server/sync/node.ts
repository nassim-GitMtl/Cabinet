import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

const cache = globalThis as unknown as { __cabinetNodeRole?: Promise<"cloud" | "clinic"> };

/** What this database is: the hosted copy or a clinic computer (fixed per installation, read once). */
export function nodeRole(): Promise<"cloud" | "clinic"> {
  return (cache.__cabinetNodeRole ??= db.execute<{ role: string }>(sql`select app_private.node_role() as role`)
    .then((rows) => (rows[0]?.role === "clinic" ? "clinic" : "cloud"))
    .catch((error: unknown) => { cache.__cabinetNodeRole = undefined; throw error; }));
}

export type NodeStatus = {
  nodeRole: "cloud" | "clinic"; state: "unpaired" | "bootstrapping" | "active"; organizationId: string | null; cloudUrl: string | null;
  lastPushAt: Date | null; lastPullAt: Date | null; lastError: string | null; lastErrorAt: Date | null;
  bootstrap: { index?: number; total?: number; done?: boolean } | null;
};

/** Sync status of this clinic computer (never the node key). */
export async function nodeStatus(): Promise<NodeStatus> {
  const rows = await db.execute<{
    node_role: "cloud" | "clinic"; state: NodeStatus["state"]; organization_id: string | null; cloud_url: string | null;
    last_push_at: string | null; last_pull_at: string | null; last_error: string | null; last_error_at: string | null; bootstrap_progress: NodeStatus["bootstrap"];
  }>(sql`select * from app_private.node_status()`);
  const r = rows[0]!;
  const date = (v: string | null) => (v ? new Date(v) : null);
  return {
    nodeRole: r.node_role, state: r.state, organizationId: r.organization_id, cloudUrl: r.cloud_url,
    lastPushAt: date(r.last_push_at), lastPullAt: date(r.last_pull_at), lastError: r.last_error, lastErrorAt: date(r.last_error_at),
    bootstrap: r.bootstrap_progress,
  };
}
