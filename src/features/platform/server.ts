import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import type { PlatformContext } from "@/server/auth/platform";
import { normalizeModules, type ProductModule } from "@/server/authz/modules";
import { db, type Tx } from "@/server/db/client";
import { organizations, staffPasswordResets } from "@/server/db/schema";
import { extendedTrialEnd, MAX_TRIAL_DAYS } from "@/lib/trial";
import { withDbContext } from "@/server/db/tenant";
import { EmailTakenError, registerClinic } from "@/server/services/onboarding";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export class PlatformError extends Error {
  constructor(public readonly code: "emailTaken" | "clinicUnavailable" | "invalidTrialDays" | "requestUnavailable") { super(code); }
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
  /** null = paid (or never on trial). */
  trialEndsAt: Date | null;
  /** Counts only: how much the clinic really uses the software (no patient or clinical content). */
  usage: { patients: number; appointments30d: number; invoices30d: number; lastActivityAt: Date | null };
};

export const TRIAL_REQUEST_STATUSES = ["new", "contacted", "converted", "declined"] as const;
export type TrialRequestStatus = (typeof TRIAL_REQUEST_STATUSES)[number];
export type TrialRequest = {
  id: string; clinicName: string; contactName: string; phone: string; email: string; city: string | null;
  practitioners: number | null; message: string | null; locale: "fr" | "en" | "ar"; status: TrialRequestStatus;
  convertedOrganizationId: string | null; createdAt: Date;
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
      trial_ends_at: Date | null; patients: number; appointments_30d: number; invoices_30d: number; last_activity_at: Date | null;
    }>(sql`select * from app_private.platform_list_organizations()`);
    return rows.map((row) => ({
      id: row.id, name: row.name, kind: row.kind, status: row.status, ownerName: row.owner_name, ownerEmail: row.owner_email,
      enabledModules: normalizeModules(row.enabled_modules), createdAt: new Date(row.created_at),
      trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
      usage: {
        patients: Number(row.patients), appointments30d: Number(row.appointments_30d), invoices30d: Number(row.invoices_30d),
        lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : null,
      },
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

/** Operator-only write on one clinic's row. Runs as "system" for the same reason as module changes. */
function asOperatorOn<T>(ctx: PlatformContext, organizationId: string, fn: (tx: Tx) => Promise<T>) {
  return withDbContext({ organizationId, userId: ctx.userId, actorType: "system" }, fn);
}

async function setTrialEnd(tx: Tx, organizationId: string, endsAt: Date | null) {
  const rows = await tx.execute<{ organization_id: string | null }>(
    sql`select app_private.platform_set_trial(${organizationId}::uuid, ${endsAt ? endsAt.toISOString() : null}::timestamptz) as organization_id`);
  if (!rows[0]?.organization_id) throw new PlatformError("clinicUnavailable");
}

function validTrialDays(days: number) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_TRIAL_DAYS) throw new PlatformError("invalidTrialDays");
}

/** Adds days to a clinic's trial (from its current end while running, from now once over). Reopens an expired clinic. */
export async function extendPlatformTrial(ctx: PlatformContext, organizationId: string, days: number, now = new Date()) {
  validTrialDays(days);
  return asOperatorOn(ctx, organizationId, async (tx) => {
    const [org] = await tx.select({ trialEndsAt: organizations.trialEndsAt }).from(organizations).where(eq(organizations.id, organizationId));
    if (!org) throw new PlatformError("clinicUnavailable");
    const endsAt = extendedTrialEnd(org.trialEndsAt, days, now);
    await setTrialEnd(tx, organizationId, endsAt);
    await audit(tx, { organizationId, actorType: "platform", actorUserId: ctx.userId, action: "platform.trial.extended", entityType: "organization", entityId: organizationId, metadata: { days, trialEndsAt: endsAt.toISOString() } });
    return endsAt;
  });
}

/** The clinic subscribed: no end date any more. */
export async function convertPlatformClinicToPaid(ctx: PlatformContext, organizationId: string) {
  await asOperatorOn(ctx, organizationId, async (tx) => {
    await setTrialEnd(tx, organizationId, null);
    await audit(tx, { organizationId, actorType: "platform", actorUserId: ctx.userId, action: "platform.trial.converted", entityType: "organization", entityId: organizationId, metadata: {} });
  });
}

export async function listTrialRequests(ctx: PlatformContext): Promise<TrialRequest[]> {
  return withDbContext({ userId: ctx.userId, actorType: "staff" }, async (tx) => {
    const rows = await tx.execute<{
      id: string; clinic_name: string; contact_name: string; phone: string; email: string; city: string | null; practitioners: number | null;
      message: string | null; locale: "fr" | "en" | "ar"; status: TrialRequestStatus; converted_organization_id: string | null; created_at: Date;
    }>(sql`select * from app_private.platform_list_trial_requests()`);
    return rows.map((r) => ({
      id: r.id, clinicName: r.clinic_name, contactName: r.contact_name, phone: r.phone, email: r.email, city: r.city,
      practitioners: r.practitioners, message: r.message, locale: r.locale, status: r.status,
      convertedOrganizationId: r.converted_organization_id, createdAt: new Date(r.created_at),
    }));
  });
}

export async function setTrialRequestStatus(ctx: PlatformContext, requestId: string, status: TrialRequestStatus, organizationId: string | null = null) {
  if (!TRIAL_REQUEST_STATUSES.includes(status)) throw new PlatformError("requestUnavailable");
  const rows = await withDbContext({ userId: ctx.userId, actorType: "staff" }, (tx) =>
    tx.execute<{ found: boolean }>(sql`select app_private.platform_update_trial_request(${requestId}::uuid, ${status}, ${organizationId}::uuid) as found`));
  if (!rows[0]?.found) throw new PlatformError("requestUnavailable");
}

export async function provisionPlatformClinic(ctx: PlatformContext, input: {
  clinicName: string; kind: "solo" | "group" | "specialist" | "pediatric" | "multi_branch";
  ownerFullName: string; email: string; ownerIsDentist: boolean; locale: "fr" | "en" | "ar"; modules: readonly string[];
  /** Free trial length; null = paid from the start. */
  trialDays?: number | null;
  /** Trial request this clinic answers (marked converted). */
  requestId?: string | null;
}, now = new Date()) {
  await assertPlatformOperator(ctx);
  const modules = normalizeModules(input.modules);
  if (input.trialDays != null) validTrialDays(input.trialDays);
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
    if (input.trialDays != null) {
      const trialEndsAt = new Date(now.getTime() + input.trialDays * 86_400_000);
      await asOperatorOn(ctx, created.organizationId, async (tx) => {
        await setTrialEnd(tx, created.organizationId, trialEndsAt);
        await audit(tx, { organizationId: created.organizationId, actorType: "platform", actorUserId: ctx.userId, action: "platform.trial.started", entityType: "organization", entityId: created.organizationId, metadata: { days: input.trialDays, trialEndsAt: trialEndsAt.toISOString() } });
      });
    }
    // The clinic exists by now: a request that vanished meanwhile must not hide its activation link.
    if (input.requestId) {
      await setTrialRequestStatus(ctx, input.requestId, "converted", created.organizationId).catch((error) => {
        if (!(error instanceof PlatformError)) throw error;
      });
    }
    return { ...created, token, expiresAt };
  } catch (error) {
    if (error instanceof EmailTakenError) throw new PlatformError("emailTaken");
    throw error;
  }
}
