import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import type { PlatformContext } from "@/server/auth/platform";
import { normalizeModules, type ProductModule } from "@/server/authz/modules";
import { db } from "@/server/db/client";
import { staffPasswordResets } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { EmailTakenError, registerClinic } from "@/server/services/onboarding";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export class PlatformError extends Error {
  constructor(public readonly code: "emailTaken" | "clinicUnavailable") { super(code); }
}

export type PlatformClinic = {
  id: string;
  name: string;
  kind: string;
  status: string;
  ownerName: string;
  ownerEmail: string;
  enabledModules: ProductModule[];
  createdAt: Date;
};

async function assertPlatformOperator(ctx: PlatformContext) {
  try {
    await withDbContext({ userId: ctx.userId, actorType: "staff" }, async (tx) => {
      await tx.execute(sql`select count(*) from app_private.platform_list_organizations()`);
    });
  } catch {
    throw new PlatformError("clinicUnavailable");
  }
}

export async function listPlatformClinics(ctx: PlatformContext): Promise<PlatformClinic[]> {
  return withDbContext({ userId: ctx.userId, actorType: "staff" }, async (tx) => {
    const rows = await tx.execute<{
      id: string; name: string; kind: string; status: string; owner_name: string; owner_email: string; enabled_modules: string[]; created_at: Date;
    }>(sql`select * from app_private.platform_list_organizations()`);
    return rows.map((row) => ({
      id: row.id, name: row.name, kind: row.kind, status: row.status, ownerName: row.owner_name, ownerEmail: row.owner_email,
      enabledModules: normalizeModules(row.enabled_modules), createdAt: new Date(row.created_at),
    }));
  });
}

export async function setPlatformClinicModules(ctx: PlatformContext, organizationId: string, modules: readonly string[]) {
  const enabled = normalizeModules(modules);
  // Not a clinic staff action: on the online copy of a clinic run from its clinic computer, staff writes are refused
  // (sync_writer_guard), but the operator's module change must apply (and is then synced to the clinic computer).
  return withDbContext({ organizationId, userId: ctx.userId, actorType: "system" }, async (tx) => {
    const moduleArray = sql`ARRAY[${sql.join(enabled.map((value) => sql`${value}`), sql`, `)}]::text[]`;
    const rows = await tx.execute<{ organization_id: string }>(sql`select app_private.platform_set_modules(${organizationId}::uuid, ${moduleArray}) as organization_id`);
    if (!rows[0]?.organization_id) throw new PlatformError("clinicUnavailable");
    await audit(tx, { organizationId, actorType: "platform", actorUserId: ctx.userId, action: "platform.modules.updated", entityType: "organization", entityId: organizationId, metadata: { enabledModules: enabled } });
  });
}

export async function provisionPlatformClinic(ctx: PlatformContext, input: {
  clinicName: string; kind: "solo" | "group" | "specialist" | "pediatric" | "multi_branch";
  ownerFullName: string; email: string; ownerIsDentist: boolean; locale: "fr" | "en" | "ar"; modules: readonly string[];
}) {
  await assertPlatformOperator(ctx);
  const modules = normalizeModules(input.modules);
  try {
    const created = await registerClinic({
      clinicName: input.clinicName, kind: input.kind, ownerFullName: input.ownerFullName, email: input.email,
      password: randomBytes(32).toString("base64url"), ownerIsDentist: input.ownerIsDentist, locale: input.locale,
      enabledModules: modules, createdByPlatformUserId: ctx.userId,
    });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await db.insert(staffPasswordResets).values({
      userId: created.userId, tokenHash: hash(token), channel: "server_command", issuedByUserId: ctx.userId, expiresAt,
    });
    return { ...created, token, expiresAt };
  } catch (error) {
    if (error instanceof EmailTakenError) throw new PlatformError("emailTaken");
    throw error;
  }
}
