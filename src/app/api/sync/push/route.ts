import { syncSql } from "@/server/sync/connection";
import { applyChanges } from "@/server/sync/engine";
import { authenticatedNode, readSyncBody, syncJson } from "@/server/sync/http";
import { isSyncChange } from "@/server/sync/types";

/** Changes made on the clinic computer, applied to the cloud copy in one transaction (safe to resend). */
export async function POST(request: Request) {
  const node = await authenticatedNode(request);
  if (node instanceof Response) return node;
  const body = await readSyncBody(request);
  const changes = Array.isArray(body?.changes) ? body.changes : null;
  if (!changes || changes.length > 2000 || !changes.every(isSyncChange)) return syncJson({ error: "badRequest" }, 400);
  return syncJson(await applyChanges(syncSql(), node.organizationId, "clinic", changes));
}
