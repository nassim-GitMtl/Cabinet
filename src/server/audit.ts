import "server-only";
import type { Tx } from "./db/client";
import { auditEvents } from "./db/schema";

export type AuditInput = {
  organizationId: string | null;
  actorType: "staff" | "patient" | "system" | "platform";
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  patientId?: string | null;
  ipAddress?: string | null;
  /** Never put clinical content or secrets here; identifiers and changed field names only. */
  metadata?: Record<string, unknown>;
};

/** Writes an audit event inside the caller's transaction (commits or rolls back with it). */
export async function audit(tx: Tx, input: AuditInput) {
  await tx.insert(auditEvents).values({
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    patientId: input.patientId ?? null,
    ipAddress: input.ipAddress ?? null,
    metadata: input.metadata ?? {},
  });
}
