import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { organizations, syncNodes } from "@/server/db/schema";
import { hashPairingCode, newPairingCode } from "@/server/sync/pairing";

export const PAIRING_MINUTES = 30;

export class SyncSetupError extends Error {
  constructor(public readonly code: "nodeAlreadyPaired") { super(code); }
}

/** Cloud: what the owner sees about the clinic computer (no secrets). */
export async function getClinicNode(ctx: ClinicContext) {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    const [org] = await tx.select({ dataHome: organizations.dataHome }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
    const [node] = await tx.select({
      id: syncNodes.id, label: syncNodes.label, pairingExpiresAt: syncNodes.pairingExpiresAt, pairedAt: syncNodes.pairedAt,
      lastSeenAt: syncNodes.lastSeenAt, createdAt: syncNodes.createdAt,
    }).from(syncNodes).where(and(eq(syncNodes.organizationId, ctx.organizationId), isNull(syncNodes.revokedAt)))
      .orderBy(desc(syncNodes.createdAt)).limit(1);
    return { dataHome: org?.dataHome ?? "cloud", node: node ?? null };
  });
}

/**
 * Cloud: single-use code (30 minutes) typed on the new clinic computer. Replaces an unused earlier code;
 * refused while a clinic computer is already paired (unpair it first).
 */
export async function createPairingCode(ctx: ClinicContext, label: string) {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    const [active] = await tx.select({ id: syncNodes.id, pairedAt: syncNodes.pairedAt }).from(syncNodes)
      .where(and(eq(syncNodes.organizationId, ctx.organizationId), isNull(syncNodes.revokedAt))).for("update").limit(1);
    if (active?.pairedAt) throw new SyncSetupError("nodeAlreadyPaired");
    if (active) await tx.update(syncNodes).set({ revokedAt: new Date(), pairingCodeHash: null }).where(eq(syncNodes.id, active.id));
    const code = newPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
    const [node] = await tx.insert(syncNodes).values({
      organizationId: ctx.organizationId, label: label.trim().slice(0, 80) || "Ordinateur du cabinet",
      pairingCodeHash: hashPairingCode(code), pairingExpiresAt: expiresAt, createdByUserId: ctx.userId,
    }).returning({ id: syncNodes.id });
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "sync.pairing_code_created", entityType: "sync_node", entityId: node!.id });
    return { code, expiresAt };
  });
}

/** Cloud: unpair the clinic computer; the online copy is in charge again (changes not yet sent are lost). */
export async function revokeClinicNode(ctx: ClinicContext) {
  requirePermission(ctx, "org.settings.manage");
  await tenantTx(ctx, async (tx) => {
    await tx.execute(sql`select app_private.revoke_sync_node()`);
    await audit(tx, { organizationId: ctx.organizationId, actorType: "staff", actorUserId: ctx.userId, action: "sync.node_revoked", entityType: "organization", entityId: ctx.organizationId });
  });
}
