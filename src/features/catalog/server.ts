import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import {
  performedProcedures,
  serviceCategories,
  serviceFavorites,
  servicePrices,
  services,
} from "@/server/db/schema";
import type { LocalizedText } from "@/server/db/schema/_shared";
import { ConflictError } from "@/server/errors";

export type CatalogService = {
  id: string;
  categoryId: string;
  code: string;
  name: LocalizedText;
  pricingUnit: string;
  anatomy: string;
  defaultDurationMin: number;
  priceMinor: number;
  currency: string;
  isDemoPrice: boolean;
  isActive: boolean;
  version: number;
};

export type CatalogCategory = { id: string; code: string; name: LocalizedText; services: CatalogService[] };

export type ServicePickerData = {
  categories: CatalogCategory[];
  favoriteIds: string[];
  recentIds: string[];
};

export async function listCatalog(ctx: ClinicContext, opts: { includeInactive?: boolean } = {}) {
  requirePermission(ctx, "catalog.read");
  return tenantTx(ctx, async (tx) => {
    const cats = await tx
      .select({ id: serviceCategories.id, code: serviceCategories.code, name: serviceCategories.name })
      .from(serviceCategories)
      .where(eq(serviceCategories.isActive, true))
      .orderBy(asc(serviceCategories.sortOrder));
    const rows = await tx
      .select({
        id: services.id,
        categoryId: services.categoryId,
        code: services.code,
        name: services.name,
        pricingUnit: services.pricingUnit,
        anatomy: services.anatomy,
        defaultDurationMin: services.defaultDurationMin,
        priceMinor: services.priceMinor,
        currency: services.currency,
        isDemoPrice: services.isDemoPrice,
        isActive: services.isActive,
        version: services.version,
      })
      .from(services)
      .where(opts.includeInactive ? undefined : eq(services.isActive, true))
      .orderBy(asc(services.code));
    return cats.map<CatalogCategory>((c) => ({ ...c, services: rows.filter((r) => r.categoryId === c.id) }));
  });
}

/** Active catalog grouped for the reusable procedure/estimate/invoice picker. */
export async function getServicePickerData(ctx: ClinicContext): Promise<ServicePickerData> {
  requirePermission(ctx, "catalog.read");
  return tenantTx(ctx, async (tx) => {
    const [cats, rows, favorites, recentRows] = await Promise.all([
      tx
        .select({ id: serviceCategories.id, code: serviceCategories.code, name: serviceCategories.name })
        .from(serviceCategories)
        .where(eq(serviceCategories.isActive, true))
        .orderBy(asc(serviceCategories.sortOrder)),
      tx
        .select({
          id: services.id,
          categoryId: services.categoryId,
          code: services.code,
          name: services.name,
          pricingUnit: services.pricingUnit,
          anatomy: services.anatomy,
          defaultDurationMin: services.defaultDurationMin,
          priceMinor: services.priceMinor,
          currency: services.currency,
          isDemoPrice: services.isDemoPrice,
          isActive: services.isActive,
          version: services.version,
        })
        .from(services)
        .where(eq(services.isActive, true))
        .orderBy(asc(services.code)),
      tx
        .select({ serviceId: serviceFavorites.serviceId })
        .from(serviceFavorites)
        .where(eq(serviceFavorites.userId, ctx.userId))
        .orderBy(desc(serviceFavorites.createdAt)),
      tx
        .select({ serviceId: performedProcedures.serviceId })
        .from(performedProcedures)
        .where(
          and(
            eq(performedProcedures.createdByUserId, ctx.userId),
            eq(performedProcedures.status, "completed"),
          ),
        )
        .orderBy(desc(performedProcedures.createdAt))
        .limit(50),
    ]);

    const activeIds = new Set(rows.map((row) => row.id));
    const recentIds = [
      ...new Set(recentRows.map((row) => row.serviceId).filter((id) => activeIds.has(id))),
    ].slice(0, 6);
    return {
      categories: cats.map<CatalogCategory>((category) => ({
        ...category,
        services: rows.filter((row) => row.categoryId === category.id),
      })),
      favoriteIds: favorites.map((row) => row.serviceId).filter((id) => activeIds.has(id)),
      recentIds,
    };
  });
}

export class CatalogItemUnavailableError extends Error {}

export async function setServiceFavorite(ctx: ClinicContext, serviceId: string, favorite: boolean) {
  requirePermission(ctx, "catalog.read");
  return tenantTx(ctx, async (tx) => {
    const [service] = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.isActive, true)))
      .limit(1);
    if (!service) throw new CatalogItemUnavailableError();

    if (favorite) {
      await tx
        .insert(serviceFavorites)
        .values({ organizationId: ctx.organizationId, userId: ctx.userId, serviceId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(serviceFavorites)
        .where(
          and(
            eq(serviceFavorites.userId, ctx.userId),
            eq(serviceFavorites.serviceId, serviceId),
          ),
        );
    }
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: favorite ? "catalog.service.favorite_added" : "catalog.service.favorite_removed",
      entityType: "service",
      entityId: serviceId,
    });
  });
}

export async function getServiceWithHistory(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "catalog.read");
  return tenantTx(ctx, async (tx) => {
    const [service] = await tx.select().from(services).where(eq(services.id, id)).limit(1);
    if (!service) return null;
    const history = await tx
      .select()
      .from(servicePrices)
      .where(eq(servicePrices.serviceId, id))
      .orderBy(sql`${servicePrices.effectiveFrom} desc`);
    return { service, history };
  });
}

export const serviceInputSchema = z.object({
  categoryId: z.uuid(),
  code: z.string().trim().min(1, "required").max(30),
  nameFr: z.string().trim().min(1, "required").max(200),
  nameEn: z.string().trim().max(200).optional(),
  nameAr: z.string().trim().max(200).optional(),
  pricingUnit: z.enum(["procedure", "tooth", "surface", "arch", "quadrant", "session", "item"]),
  anatomy: z.enum(["none", "tooth", "surface", "arch", "quadrant"]),
  defaultDurationMin: z.coerce.number().int().min(0).max(600),
  priceMinor: z.number().int().min(0),
  priceChangeReason: z.string().trim().max(300).optional(),
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;

const nameOf = (i: ServiceInput): LocalizedText => ({
  fr: i.nameFr,
  ...(i.nameEn ? { en: i.nameEn } : {}),
  ...(i.nameAr ? { ar: i.nameAr } : {}),
});

export class DuplicateCodeError extends Error {}

export async function createService(ctx: ClinicContext, input: ServiceInput) {
  requirePermission(ctx, "catalog.manage");
  return tenantTx(ctx, async (tx) => {
    const exists = await tx
      .select({ id: services.id })
      .from(services)
      .where(eq(services.code, input.code))
      .limit(1);
    if (exists.length) throw new DuplicateCodeError();
    const [svc] = await tx
      .insert(services)
      .values({
        organizationId: ctx.organizationId,
        categoryId: input.categoryId,
        code: input.code,
        name: nameOf(input),
        pricingUnit: input.pricingUnit,
        anatomy: input.anatomy,
        defaultDurationMin: input.defaultDurationMin,
        priceMinor: input.priceMinor,
        currency: ctx.organization.defaultCurrency,
      })
      .returning({ id: services.id });
    await tx.insert(servicePrices).values({
      organizationId: ctx.organizationId,
      serviceId: svc!.id,
      priceMinor: input.priceMinor,
      currency: ctx.organization.defaultCurrency,
      reason: "created",
      changedByUserId: ctx.userId,
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: "catalog.service.created",
      entityType: "service",
      entityId: svc!.id,
    });
    return svc!.id;
  });
}

/**
 * Updates a service. A price change appends to service_prices and clears the
 * demo flag; it never touches estimates or issued invoices (they hold snapshots).
 */
export async function updateService(ctx: ClinicContext, id: string, input: ServiceInput, expectedVersion: number) {
  requirePermission(ctx, "catalog.manage");
  return tenantTx(ctx, async (tx) => {
    const [current] = await tx.select().from(services).where(eq(services.id, id)).limit(1);
    if (!current) throw new ConflictError();
    if (input.code !== current.code) {
      const clash = await tx.select({ id: services.id }).from(services).where(eq(services.code, input.code)).limit(1);
      if (clash.length) throw new DuplicateCodeError();
    }
    const priceChanged = current.priceMinor !== input.priceMinor;
    const updated = await tx
      .update(services)
      .set({
        categoryId: input.categoryId,
        code: input.code,
        name: nameOf(input),
        pricingUnit: input.pricingUnit,
        anatomy: input.anatomy,
        defaultDurationMin: input.defaultDurationMin,
        priceMinor: input.priceMinor,
        isDemoPrice: priceChanged ? false : current.isDemoPrice,
        updatedAt: new Date(),
        version: sql`${services.version} + 1`,
      })
      .where(and(eq(services.id, id), eq(services.version, expectedVersion)))
      .returning({ id: services.id });
    if (!updated.length) throw new ConflictError();
    if (priceChanged) {
      await tx.insert(servicePrices).values({
        organizationId: ctx.organizationId,
        serviceId: id,
        priceMinor: input.priceMinor,
        currency: current.currency,
        reason: input.priceChangeReason || null,
        changedByUserId: ctx.userId,
      });
    }
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: priceChanged ? "catalog.service.price_changed" : "catalog.service.updated",
      entityType: "service",
      entityId: id,
      metadata: priceChanged ? { from: current.priceMinor, to: input.priceMinor } : {},
    });
  });
}

/** Deactivation keeps the service and all its history; it only hides it from pickers. */
export async function setServiceActive(ctx: ClinicContext, id: string, active: boolean) {
  requirePermission(ctx, "catalog.manage");
  return tenantTx(ctx, async (tx) => {
    await tx
      .update(services)
      .set({ isActive: active, updatedAt: new Date(), version: sql`${services.version} + 1` })
      .where(eq(services.id, id));
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: active ? "catalog.service.activated" : "catalog.service.deactivated",
      entityType: "service",
      entityId: id,
    });
  });
}
