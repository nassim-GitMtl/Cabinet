import { syncSql } from "@/server/sync/connection";
import { snapshotTables } from "@/server/sync/engine";
import { cloudGuard, readSyncBody, syncJson } from "@/server/sync/http";
import { claimPairing } from "@/server/sync/pairing";

/** A new clinic computer exchanges the owner's single-use code for its node key. */
export async function POST(request: Request) {
  const denied = await cloudGuard(request);
  if (denied) return denied;
  const body = await readSyncBody(request);
  const code = typeof body?.code === "string" ? body.code : "";
  const claim = code ? await claimPairing(syncSql(), code) : null;
  if (!claim) return syncJson({ error: "pairingUnavailable" }, 404);
  return syncJson({
    organizationId: claim.organizationId, nodeKey: claim.nodeKey, pullFrom: claim.pullFrom,
    tables: await snapshotTables(syncSql()),
  });
}
