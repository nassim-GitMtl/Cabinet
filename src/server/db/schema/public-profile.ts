// Clinic public page (§9A, patient acquisition): what the clinic chooses to show at /c/<slug>.
// Unpublished by default. Visitors read it only through app_private.resolve_public_clinic (published,
// active clinics) and then tenant-scoped RLS queries that select public fields only.
import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt } from "./_shared";
import { bookingLinks } from "./booking";
import { organizations, users } from "./platform";

export type PublicAbout = { fr?: string; en?: string; ar?: string };

export const clinicPublicProfiles = pgTable(
  "clinic_public_profiles",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Lowercase URL name, e.g. "cabinet-les-oliviers" → /c/cabinet-les-oliviers. Unique across clinics. */
    slug: text("slug").notNull(),
    isPublished: boolean("is_published").notNull().default(false),
    about: jsonb("about").$type<PublicAbout>().notNull().default({}),
    /** E.164; defaults to the branch phone on the page when empty. */
    whatsappPhone: text("whatsapp_phone"),
    mapUrl: text("map_url"),
    facebookUrl: text("facebook_url"),
    instagramUrl: text("instagram_url"),
    /** Booking link behind "Prendre rendez-vous"; ignored when inactive. */
    bookingLinkId: uuid("booking_link_id").references(() => bookingLinks.id),
    featuredServiceIds: uuid("featured_service_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** Prices are shown ("à partir de") only when the clinic opts in. */
    showPrices: boolean("show_prices").notNull().default(false),
    updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("clinic_public_profiles_org_uq").on(t.organizationId),
    uniqueIndex("clinic_public_profiles_slug_uq").on(t.slug),
    check("clinic_public_profiles_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'`),
    check("clinic_public_profiles_featured_max", sql`cardinality(${t.featuredServiceIds}) <= 24`),
  ],
);
