import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { normalizePhone } from "@/lib/phone";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { db } from "@/server/db/client";
import { bookingLinks, branches, clinicPublicProfiles, organizations, serviceCategories, services } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import { isValidSlug, mergeWeeklyHours, safeHttpsUrl, slugify } from "./helpers";

export class PublicPageError extends Error {
  constructor(public readonly code: string, public readonly field?: string) { super(code); }
}

export type PublicProfileInput = {
  slug: string;
  isPublished: boolean;
  about: { fr: string; en: string; ar: string };
  whatsappPhone: string;
  mapUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  bookingLinkId: string | null;
  featuredServiceIds: string[];
  showPrices: boolean;
};

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

export async function getPublicPageSettings(ctx: ClinicContext) {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    const [profile] = await tx.select().from(clinicPublicProfiles).limit(1);
    const links = await tx.select({ id: bookingLinks.id, label: bookingLinks.label, token: bookingLinks.token })
      .from(bookingLinks).where(eq(bookingLinks.isActive, true)).orderBy(asc(bookingLinks.createdAt));
    const serviceRows = await tx
      .select({ id: services.id, name: services.name, priceMinor: services.priceMinor, category: serviceCategories.name })
      .from(services)
      .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
      .where(eq(services.isActive, true))
      .orderBy(asc(serviceCategories.sortOrder), asc(services.code));
    const [branch] = await tx.select({ phone: branches.phone }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt)).limit(1);
    return { profile: profile ?? null, suggestedSlug: slugify(ctx.organization.name), links, services: serviceRows, branchPhone: branch?.phone ?? null };
  });
}

export async function savePublicProfile(ctx: ClinicContext, input: PublicProfileInput) {
  requirePermission(ctx, "org.settings.manage");
  const slug = input.slug.trim().toLowerCase();
  if (!isValidSlug(slug)) throw new PublicPageError("slug", "slug");
  const whatsappPhone = input.whatsappPhone.trim() ? normalizePhone(input.whatsappPhone, ctx.organization.countryCode) : null;
  if (input.whatsappPhone.trim() && !whatsappPhone) throw new PublicPageError("invalidPhone", "whatsappPhone");
  const urls = { mapUrl: input.mapUrl, facebookUrl: input.facebookUrl, instagramUrl: input.instagramUrl };
  for (const [field, value] of Object.entries(urls)) if (value.trim() && !safeHttpsUrl(value)) throw new PublicPageError("invalidUrl", field);
  const featured = [...new Set(input.featuredServiceIds)];
  if (featured.length > 24) throw new PublicPageError("tooManyServices", "featuredServiceIds");
  const about = Object.fromEntries(Object.entries(input.about).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));

  return tenantTx(ctx, async (tx) => {
    const [taken] = await tx.execute<{ taken: boolean }>(sql`select app_private.public_slug_taken(${slug}, ${ctx.organizationId}) as taken`);
    if (taken?.taken) throw new PublicPageError("slugTaken", "slug");
    if (input.bookingLinkId) {
      const [link] = await tx.select({ id: bookingLinks.id }).from(bookingLinks).where(and(eq(bookingLinks.id, input.bookingLinkId), eq(bookingLinks.isActive, true))).limit(1);
      if (!link) throw new PublicPageError("bookingLinkUnavailable", "bookingLinkId");
    }
    if (featured.length) {
      const found = await tx.select({ id: services.id }).from(services).where(and(inArray(services.id, featured), eq(services.isActive, true)));
      if (found.length !== featured.length) throw new PublicPageError("serviceUnavailable", "featuredServiceIds");
    }
    const values = {
      slug, isPublished: input.isPublished, about, whatsappPhone,
      mapUrl: safeHttpsUrl(input.mapUrl), facebookUrl: safeHttpsUrl(input.facebookUrl), instagramUrl: safeHttpsUrl(input.instagramUrl),
      bookingLinkId: input.bookingLinkId, featuredServiceIds: featured, showPrices: input.showPrices,
      updatedByUserId: ctx.userId, updatedAt: new Date(),
    };
    try {
      await tx.insert(clinicPublicProfiles).values({ ...values, organizationId: ctx.organizationId })
        .onConflictDoUpdate({ target: clinicPublicProfiles.organizationId, set: values });
    } catch (error) {
      // Another clinic took the same address between the check and the write.
      if ((error as { cause?: { code?: string } }).cause?.code === "23505") throw new PublicPageError("slugTaken", "slug");
      throw error;
    }
    await audit(tx, { ...staff(ctx), action: "org.public_page_saved", entityType: "organization", entityId: ctx.organizationId, metadata: { slug, published: input.isPublished } });
  });
}

/**
 * Visitor view of a published page: public fields only (no patient data, no staff accounts).
 * Returns null when the page does not exist, is unpublished, or the clinic is not active.
 */
export async function getPublicClinicPage(rawSlug: string) {
  const slug = rawSlug.toLowerCase();
  if (!isValidSlug(slug)) return null;
  const [row] = await db.execute<{ organization_id: string }>(sql`select * from app_private.resolve_public_clinic(${slug})`);
  if (!row) return null;
  return withDbContext({ organizationId: row.organization_id, actorType: "system" }, async (tx) => {
    const [org] = await tx.select({ name: organizations.name, currency: organizations.defaultCurrency, settings: organizations.settings, countryCode: organizations.countryCode }).from(organizations);
    const [profile] = await tx.select().from(clinicPublicProfiles).limit(1);
    if (!org || !profile) return null;
    const branchRows = await tx.select({ name: branches.name, address: branches.address, phone: branches.phone })
      .from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.createdAt));
    const hours = await tx.execute<{ weekday: number; start: string; end: string }>(sql`
      select wh.weekday, wh.start_time::text as start, wh.end_time::text as end
        from working_hours wh join memberships m on m.id = wh.provider_id
       where m.is_provider and m.status = 'active'`);
    const featured = profile.featuredServiceIds.length
      ? await tx.select({ id: services.id, name: services.name, priceMinor: services.priceMinor })
          .from(services).where(and(inArray(services.id, profile.featuredServiceIds), eq(services.isActive, true)))
      : [];
    const links = await tx.select({ id: bookingLinks.id, token: bookingLinks.token }).from(bookingLinks)
      .where(eq(bookingLinks.isActive, true)).orderBy(asc(bookingLinks.createdAt));
    const link = links.find((l) => l.id === profile.bookingLinkId) ?? links[0] ?? null;
    const phone = branchRows.find((b) => b.phone)?.phone ?? null;
    return {
      slug: profile.slug,
      name: org.name,
      about: profile.about,
      branches: branchRows,
      phone,
      whatsappPhone: profile.whatsappPhone ?? phone,
      mapUrl: profile.mapUrl,
      facebookUrl: profile.facebookUrl,
      instagramUrl: profile.instagramUrl,
      hours: mergeWeeklyHours(hours),
      services: profile.featuredServiceIds
        .map((id) => featured.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({ id: s.id, name: s.name, priceMinor: profile.showPrices ? s.priceMinor : null })),
      currency: org.currency,
      currencyDisplay: org.settings.currencyDisplay ?? null,
      bookingToken: link?.token ?? null,
    };
  });
}
