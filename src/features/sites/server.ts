import "server-only";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { appointments, branches, legalEntities } from "@/server/db/schema";
import { normalizePhone } from "@/lib/phone";
import { mainSiteId } from "@/server/sites";

/**
 * Sites (branches) of one clinic group (module `multi_site` to add more than the first). Patients, the catalog,
 * the team and invoices are shared; each site has its own chairs, working hours, agenda and cash drawer.
 */
export class SiteError extends Error {
  constructor(public readonly code: "nameRequired" | "nameTaken" | "invalidPhone" | "lastSite" | "siteHasAppointments" | "notFound") {
    super(code);
  }
}

export type SiteInput = { name: string; address: string | null; phone: string | null; email: string | null };

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

function clean(ctx: ClinicContext, input: SiteInput) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new SiteError("nameRequired");
  const phone = input.phone?.trim() ? normalizePhone(input.phone, ctx.organization.countryCode) : null;
  if (input.phone?.trim() && !phone) throw new SiteError("invalidPhone");
  return { name, address: input.address?.trim().slice(0, 300) || null, phone, email: input.email?.trim().slice(0, 200) || null };
}

export async function listSites(ctx: ClinicContext) {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    const main = await mainSiteId(tx);
    const rows = await tx.select().from(branches).orderBy(desc(branches.isActive), asc(branches.createdAt));
    return rows.map((b) => ({ ...b, isMain: b.id === main }));
  });
}

export async function createSite(ctx: ClinicContext, input: SiteInput) {
  requirePermission(ctx, "branches.manage");
  const values = clean(ctx, input);
  return tenantTx(ctx, async (tx) => {
    const [taken] = await tx.select({ id: branches.id }).from(branches).where(sql`lower(${branches.name}) = lower(${values.name})`).limit(1);
    if (taken) throw new SiteError("nameTaken");
    const [le] = await tx.select({ id: legalEntities.id }).from(legalEntities).orderBy(desc(legalEntities.isDefault)).limit(1);
    const [row] = await tx
      .insert(branches)
      .values({ organizationId: ctx.organizationId, legalEntityId: le!.id, ...values, timezone: ctx.organization.timezone })
      .returning({ id: branches.id });
    await audit(tx, { ...staff(ctx), action: "site.created", entityType: "branch", entityId: row!.id });
    return row!.id;
  });
}

export async function updateSite(ctx: ClinicContext, id: string, input: SiteInput) {
  requirePermission(ctx, "org.settings.manage");
  const values = clean(ctx, input);
  return tenantTx(ctx, async (tx) => {
    const [taken] = await tx.select({ id: branches.id }).from(branches)
      .where(and(sql`lower(${branches.name}) = lower(${values.name})`, sql`${branches.id} <> ${id}`)).limit(1);
    if (taken) throw new SiteError("nameTaken");
    const [row] = await tx.update(branches).set(values).where(eq(branches.id, id)).returning({ id: branches.id });
    if (!row) throw new SiteError("notFound");
    await audit(tx, { ...staff(ctx), action: "site.updated", entityType: "branch", entityId: id, metadata: { fields: Object.keys(values) } });
  });
}

/** Closes or reopens a site. A site with booked appointments to come, or the last open site, cannot be closed. */
export async function setSiteActive(ctx: ClinicContext, id: string, active: boolean) {
  requirePermission(ctx, "branches.manage");
  return tenantTx(ctx, async (tx) => {
    const [site] = await tx.select().from(branches).where(eq(branches.id, id)).for("update").limit(1);
    if (!site) throw new SiteError("notFound");
    if (site.isActive === active) return;
    if (!active) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(branches).where(eq(branches.isActive, true));
      if (n <= 1) throw new SiteError("lastSite");
      const [booked] = await tx.select({ id: appointments.id }).from(appointments)
        .where(and(eq(appointments.branchId, id), eq(appointments.schedulingStatus, "booked"), gt(appointments.startsAt, new Date()))).limit(1);
      if (booked) throw new SiteError("siteHasAppointments");
    }
    await tx.update(branches).set({ isActive: active }).where(eq(branches.id, id));
    await audit(tx, { ...staff(ctx), action: active ? "site.activated" : "site.deactivated", entityType: "branch", entityId: id });
  });
}
