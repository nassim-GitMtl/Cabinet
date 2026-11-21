import { syncSql } from "@/server/sync/connection";
import { exportSnapshotPage, snapshotReady } from "@/server/sync/engine";
import { authenticatedNode, readSyncBody, syncJson } from "@/server/sync/http";

/** One page of the clinic's first full copy (parents first; the clinic computer asks table by table). */
export async function POST(request: Request) {
  const node = await authenticatedNode(request);
  if (node instanceof Response) return node;
  const body = await readSyncBody(request);
  const table = typeof body?.table === "string" ? body.table : "";
  const after = typeof body?.after === "string" ? body.after : null;
  const waitFor = typeof body?.waitFor === "string" && /^\d{1,20}$/.test(body.waitFor) ? body.waitFor : null;
  if (!table || !waitFor) return syncJson({ error: "badRequest" }, 400);
  if (!(await snapshotReady(syncSql(), waitFor))) return syncJson({ error: "notReady" }, 409);
  try {
    return syncJson(await exportSnapshotPage(syncSql(), node.organizationId, table, after));
  } catch {
    return syncJson({ error: "badRequest" }, 400);
  }
}
