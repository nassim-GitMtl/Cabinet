import { syncSql } from "@/server/sync/connection";
import { readChanges } from "@/server/sync/engine";
import { authenticatedNode, readSyncBody, syncJson } from "@/server/sync/http";
import { isSyncCursor } from "@/server/sync/types";

/** Changes made in the cloud for this clinic (patients' online actions), from the clinic computer's cursor. */
export async function POST(request: Request) {
  const node = await authenticatedNode(request);
  if (node instanceof Response) return node;
  const body = await readSyncBody(request);
  if (!isSyncCursor(body?.cursor)) return syncJson({ error: "badRequest" }, 400);
  return syncJson(await readChanges(syncSql(), node.organizationId, "cloud", body.cursor));
}
