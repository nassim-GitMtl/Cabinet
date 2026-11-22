import "server-only";
import { sql } from "drizzle-orm";
import { audit } from "../audit";
import { ROLE_TEMPLATES, type RoleTemplateKey } from "../authz/permissions";
import { STARTER_CATALOG } from "../catalog/starter-catalog";
import { db, type Database, type Tx } from "../db/client";
import {
  noteTemplates,
  appointmentTypes,
  chairs,
  workingHours,
  branches,
  legalEntities,
  memberships,
  organizations,
  roles,
  serviceCategories,
  servicePrices,
  services,
  users,
} from "../db/schema";
import { setTxOrganization } from "../db/tenant";
import { hashPassword } from "../auth/password";
import { currencyExponent } from "@/lib/money";
import { PRODUCT_MODULES } from "../authz/modules";

export type RegisterClinicInput = {
  clinicName: string;
  kind: "solo" | "group" | "specialist" | "pediatric" | "multi_branch";
  ownerFullName: string;
  email: string;
  password: string;
  ownerIsDentist: boolean;
  locale: "fr" | "en" | "ar";
  currency?: string;
  timezone?: string;
  countryCode?: string;
  enabledModules?: string[];
  createdByPlatformUserId?: string;
};

export class EmailTakenError extends Error {}

/**
 * Creates a user, a new independent clinic tenant (organization + default
 * legal entity + main branch), system roles from templates, the owner
 * membership and the editable starter catalog. All in one transaction.
 */
export async function registerClinic(input: RegisterClinicInput, database: Database = db) {
  const passwordHash = await hashPassword(input.password);
  const currency = input.currency ?? "DZD";
  const timezone = input.timezone ?? "Africa/Algiers";

  return database.transaction(async (tx) => {
    const existing = await tx.execute(
      sql`select 1 from users where lower(email) = lower(${input.email}) limit 1`,
    );
    if (existing.length > 0) throw new EmailTakenError();

    const [user] = await tx
      .insert(users)
      .values({
        email: input.email.trim(),
        fullName: input.ownerFullName.trim(),
        passwordHash,
        locale: input.locale,
      })
      .returning({ id: users.id });

    // Allocate the org id first so RLS context can be set before inserting it
    // (INSERT ... RETURNING must satisfy the SELECT policy).
    const [{ id: organizationId }] = (await tx.execute<{ id: string }>(sql`select uuidv7() as id`)) as unknown as [
      { id: string },
    ];
    await setTxOrganization(tx, organizationId);
    await tx.execute(sql`select set_config('app.user_id', ${user!.id}, true)`);

    await tx.insert(organizations).values({
      id: organizationId,
      name: input.clinicName.trim(),
      kind: input.kind,
      status: "active",
      defaultLocale: input.locale,
      defaultCurrency: currency,
      timezone,
      countryCode: input.countryCode ?? "DZ",
      enabledModules: input.enabledModules ?? [...PRODUCT_MODULES],
      settings: { currencyDisplay: currency === "DZD" ? "DA" : currency, dateFormat: "DD/MM/YYYY" },
    });

    const [legalEntity] = await tx
      .insert(legalEntities)
      .values({ organizationId, legalName: input.clinicName.trim(), currency, isDefault: true })
      .returning({ id: legalEntities.id });

    const [branch] = await tx
      .insert(branches)
      .values({ organizationId, legalEntityId: legalEntity!.id, name: input.clinicName.trim(), timezone })
      .returning({ id: branches.id });

    const roleRows = await tx
      .insert(roles)
      .values(
        (Object.keys(ROLE_TEMPLATES) as RoleTemplateKey[]).map((key) => ({
          organizationId,
          key,
          name: ROLE_TEMPLATES[key].name,
          permissions: ROLE_TEMPLATES[key].permissions,
          isSystem: true,
        })),
      )
      .returning({ id: roles.id, key: roles.key });
    const ownerRole = roleRows.find((r) => r.key === "owner")!;

    const [membership] = await tx
      .insert(memberships)
      .values({
        organizationId,
        userId: user!.id,
        roleId: ownerRole.id,
        displayName: input.ownerFullName.trim(),
        title: input.ownerIsDentist ? "Dr" : null,
        isProvider: input.ownerIsDentist,
      })
      .returning({ id: memberships.id });

    await seedSchedulingDefaults(tx, organizationId, branch!.id, input.ownerIsDentist ? membership!.id : null);
    await tx.insert(noteTemplates).values(STARTER_NOTE_TEMPLATES.map((n) => ({ organizationId, ...n })));

    await seedStarterCatalog(tx, organizationId, user!.id, currency);

    await audit(tx, {
      organizationId,
      actorType: input.createdByPlatformUserId ? "platform" : "staff",
      actorUserId: input.createdByPlatformUserId ?? user!.id,
      action: "organization.created",
      entityType: "organization",
      entityId: organizationId,
      metadata: input.createdByPlatformUserId ? { provisionedByPlatform: true, enabledModules: input.enabledModules ?? [] } : undefined,
    });

    return { userId: user!.id, organizationId };
  });
}

/** Editable defaults: one chair, common appointment types, Sun–Thu working hours. */
/** Structure-only starter note templates (clinics adapt the wording). */
const STARTER_NOTE_TEMPLATES = [
  { name: "Consultation", kind: "consultation" as const, body: { chiefComplaint: "", observations: "Examen exobuccal :\nExamen endobuccal :", assessment: "", plan: "" } },
  { name: "Soins conservateurs", kind: "procedure" as const, body: { performedWork: "Anesthésie :\nPréparation :\nObturation :", plan: "Contrôle :" } },
  { name: "Extraction", kind: "procedure" as const, body: { performedWork: "Anesthésie :\nAvulsion :\nHémostase :", plan: "Conseils post-opératoires remis :\nContrôle :" } },
  { name: "Détartrage", kind: "procedure" as const, body: { performedWork: "Détartrage sus- et sous-gingival :\nPolissage :", plan: "Prochain détartrage :" } },
  { name: "Contrôle", kind: "progress" as const, body: { observations: "", assessment: "", plan: "" } },
];

export async function seedSchedulingDefaults(tx: Tx, organizationId: string, branchId: string, providerId: string | null) {
  await tx.insert(chairs).values({ organizationId, branchId, name: "Fauteuil 1" });
  await tx.insert(appointmentTypes).values(
    DEFAULT_APPOINTMENT_TYPES.map((a) => ({ organizationId, code: a.code, name: a.name, defaultDurationMin: a.duration, color: a.color, isBookableOnline: ["CONSULT", "HYGIENE", "FOLLOWUP"].includes(a.code) })),
  );
  if (providerId) await tx.insert(workingHours).values(defaultWorkingHours(organizationId, providerId, branchId));
}

export function defaultWorkingHours(organizationId: string, providerId: string, branchId: string) {
  // Algeria: weekend is Friday–Saturday. ISO weekday 7 = Sunday.
  return [7, 1, 2, 3, 4].flatMap((weekday) =>
    [
      ["08:00", "12:00"],
      ["13:00", "17:00"],
    ].map(([startTime, endTime]) => ({ organizationId, providerId, branchId, weekday, startTime: startTime!, endTime: endTime! })),
  );
}

const DEFAULT_APPOINTMENT_TYPES = [
  { code: "CONSULT", name: { fr: "Consultation", en: "Consultation", ar: "استشارة" }, duration: 20, color: "teal" },
  { code: "CARE", name: { fr: "Soins", en: "Treatment", ar: "علاج" }, duration: 30, color: "blue" },
  { code: "HYGIENE", name: { fr: "Détartrage", en: "Hygiene", ar: "إزالة الجير" }, duration: 30, color: "green" },
  { code: "SURGERY", name: { fr: "Chirurgie", en: "Surgery", ar: "جراحة" }, duration: 60, color: "red" },
  { code: "PROSTH", name: { fr: "Prothèse", en: "Prosthetics", ar: "تركيبات" }, duration: 45, color: "violet" },
  { code: "FOLLOWUP", name: { fr: "Contrôle", en: "Follow-up", ar: "متابعة" }, duration: 15, color: "gray" },
  { code: "URGENT", name: { fr: "Urgence", en: "Emergency", ar: "استعجال" }, duration: 20, color: "orange" },
];

export async function seedStarterCatalog(tx: Tx, organizationId: string, userId: string, currency: string) {
  const factor = 10 ** currencyExponent(currency);
  for (const [index, category] of STARTER_CATALOG.entries()) {
    const [cat] = await tx
      .insert(serviceCategories)
      .values({ organizationId, code: category.code, name: category.name, sortOrder: index })
      .returning({ id: serviceCategories.id });
    const created = await tx
      .insert(services)
      .values(
        category.services.map((svc) => ({
          organizationId,
          categoryId: cat!.id,
          code: svc.code,
          name: svc.name,
          pricingUnit: svc.unit,
          anatomy: svc.anatomy,
          defaultDurationMin: svc.durationMin,
          priceMinor: svc.demoPrice * factor,
          currency,
          isDemoPrice: true,
        })),
      )
      .returning({ id: services.id, priceMinor: services.priceMinor });
    await tx.insert(servicePrices).values(
      created.map((c) => ({
        organizationId,
        serviceId: c.id,
        priceMinor: c.priceMinor,
        currency,
        reason: "starter_catalog_demo",
        changedByUserId: userId,
      })),
    );
  }
}
