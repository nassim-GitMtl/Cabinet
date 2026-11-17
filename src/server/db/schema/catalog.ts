import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt, version, type LocalizedText } from "./_shared";
import { organizations, users } from "./platform";

export const serviceCategories = pgTable(
  "service_categories",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    code: text("code").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("service_categories_org_code_uq").on(t.organizationId, t.code)],
);

export const pricingUnit = pgEnum("pricing_unit", [
  "procedure",
  "tooth",
  "surface",
  "arch",
  "quadrant",
  "session",
  "item",
]);
export const anatomyRequirement = pgEnum("anatomy_requirement", [
  "none",
  "tooth",
  "surface",
  "arch",
  "quadrant",
]);

export const services = pgTable(
  "services",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => serviceCategories.id),
    code: text("code").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    description: jsonb("description").$type<LocalizedText | null>(),
    pricingUnit: pricingUnit("pricing_unit").notNull().default("procedure"),
    anatomy: anatomyRequirement("anatomy").notNull().default("none"),
    defaultDurationMin: integer("default_duration_min").notNull().default(30),
    /** Current default selling price in minor units of `currency`. History in service_prices. */
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("DZD"),
    /** Basis points; null = no tax configured. Never assumed. */
    taxRateBp: integer("tax_rate_bp"),
    /** Internal estimate, separate from selling price. */
    materialCostMinor: bigint("material_cost_minor", { mode: "number" }),
    noteTemplate: text("note_template"),
    /** True for seeded demonstration prices: never official tariffs. */
    isDemoPrice: boolean("is_demo_price").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex("services_org_code_uq").on(t.organizationId, t.code),
    index("services_org_category_idx").on(t.organizationId, t.categoryId),
    index("services_name_trgm_idx").using(
      "gin",
      sql`public.f_unaccent(lower(${t.code} || ' ' || (${t.name}->>'fr') || ' ' || coalesce(${t.name}->>'en', '') || ' ' || coalesce(${t.name}->>'ar', ''))) gin_trgm_ops`,
    ),
  ],
);

/** Append-only price history. A price change never rewrites issued documents. */
export const servicePrices = pgTable(
  "service_prices",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason"),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("service_prices_service_idx").on(t.serviceId, t.effectiveFrom)],
);
