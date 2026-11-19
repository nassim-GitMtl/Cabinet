import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { memberships, patientAlerts, patients } from "@/server/db/schema";
import { nextCounter } from "@/server/db/tenant";
import { normalizePhone } from "@/lib/phone";
import type { PatientInput } from "./schemas";

export type PatientListItem = {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  firstNameAr: string | null;
  lastNameAr: string | null;
  phone: string | null;
  birthDate: string | null;
  status: "active" | "inactive" | "archived" | "deceased";
  createdAt: Date;
};

const normalizeQuery = (q: string) =>
  q
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Accent-insensitive search on names (Latin/Arabic), patient number and phones. */
export async function searchPatients(
  ctx: ClinicContext,
  opts: { q?: string; status?: "active" | "all" | "archived"; page?: number; pageSize?: number },
) {
  requirePermission(ctx, "patient.read");
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);

  const filters: SQL[] = [];
  if (opts.status === "archived") filters.push(eq(patients.status, "archived"));
  else if (opts.status !== "all") filters.push(ne(patients.status, "archived"));

  const q = opts.q ? normalizeQuery(opts.q) : "";
  if (q) {
    // Every term must match. A national-format phone fragment ("0555…") also
    // matches the stored E.164 form ("+213555…").
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);
    const termFilters = terms.map((term) => {
      const digits = term.replace(/\D/g, "");
      return or(
        sql`${patients.searchText} like ${"%" + term + "%"}`,
        digits.length >= 4 && digits.startsWith("0")
          ? sql`${patients.searchText} like ${"%" + digits.slice(1) + "%"}`
          : undefined,
      )!;
    });
    const phone = normalizePhone(opts.q, ctx.organization.countryCode);
    filters.push(
      phone ? or(eq(patients.phone, phone), eq(patients.phoneAlt, phone), and(...termFilters))! : and(...termFilters)!,
    );
  }

  return tenantTx(ctx, async (tx) => {
    const where = filters.length ? and(...filters) : undefined;
    const rows = await tx
        .select({
          id: patients.id,
          patientNumber: patients.patientNumber,
          firstName: patients.firstName,
          lastName: patients.lastName,
          firstNameAr: patients.firstNameAr,
          lastNameAr: patients.lastNameAr,
          phone: patients.phone,
          birthDate: patients.birthDate,
          status: patients.status,
          createdAt: patients.createdAt,
        })
        .from(patients)
        .where(where)
        .orderBy(q ? asc(patients.lastName) : desc(patients.createdAt), asc(patients.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
    const [totals] = await tx.select({ total: count() }).from(patients).where(where);
    return { rows: rows as PatientListItem[], total: totals?.total ?? 0, page, pageSize };
  });
}

export async function getPatient(ctx: ClinicContext, id: string) {
  requirePermission(ctx, "patient.read");
  return tenantTx(ctx, async (tx) => {
    const [patient] = await tx.select().from(patients).where(eq(patients.id, id)).limit(1);
    if (!patient) return null;
    const alerts = ctxCanReadAlerts(ctx)
      ? await tx
          .select()
          .from(patientAlerts)
          .where(and(eq(patientAlerts.patientId, id), isNull(patientAlerts.resolvedAt)))
          .orderBy(desc(patientAlerts.severity), desc(patientAlerts.createdAt))
      : [];
    const provider = patient.assignedProviderId
      ? (
          await tx
            .select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title })
            .from(memberships)
            .where(eq(memberships.id, patient.assignedProviderId))
            .limit(1)
        )[0] ?? null
      : null;
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: "patient.viewed",
      entityType: "patient",
      entityId: id,
      patientId: id,
    });
    return { patient, alerts, provider };
  });
}

const ctxCanReadAlerts = (ctx: ClinicContext) => ctx.permissions.includes("patient.alerts.read");

export async function listProviders(ctx: ClinicContext) {
  return tenantTx(ctx, (tx) =>
    tx
      .select({ id: memberships.id, displayName: memberships.displayName, title: memberships.title })
      .from(memberships)
      .where(and(eq(memberships.isProvider, true), eq(memberships.status, "active")))
      .orderBy(asc(memberships.displayName)),
  );
}

export type DuplicateCandidate = Pick<
  PatientListItem,
  "id" | "patientNumber" | "firstName" | "lastName" | "phone" | "birthDate"
>;

/** Clinic-local duplicate candidates only. Never searches other clinics. */
async function findDuplicates(
  tx: Parameters<Parameters<typeof tenantTx>[1]>[0],
  input: { firstName: string; lastName: string; birthDate: string | null; phone: string | null },
): Promise<DuplicateCandidate[]> {
  const conds: SQL[] = [];
  if (input.phone) conds.push(or(eq(patients.phone, input.phone), eq(patients.phoneAlt, input.phone))!);
  conds.push(
    and(
      ilike(sql`public.f_unaccent(${patients.lastName})`, sql`public.f_unaccent(${input.lastName})`),
      ilike(sql`public.f_unaccent(${patients.firstName})`, sql`public.f_unaccent(${input.firstName})`),
      input.birthDate ? eq(patients.birthDate, input.birthDate) : undefined,
    )!,
  );
  return tx
    .select({
      id: patients.id,
      patientNumber: patients.patientNumber,
      firstName: patients.firstName,
      lastName: patients.lastName,
      phone: patients.phone,
      birthDate: patients.birthDate,
    })
    .from(patients)
    .where(and(or(...conds), ne(patients.status, "archived")))
    .limit(5);
}

function toRow(input: PatientInput, countryCode: string) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    firstNameAr: input.firstNameAr,
    lastNameAr: input.lastNameAr,
    sex: input.sex ?? null,
    birthDate: input.birthDate,
    birthDatePrecision: input.birthDate ? input.birthDatePrecision : null,
    phone: normalizePhone(input.phone, countryCode) ?? input.phone,
    phoneAlt: normalizePhone(input.phoneAlt, countryCode) ?? input.phoneAlt,
    email: input.email,
    addressLine: input.addressLine,
    city: input.city,
    region: input.region,
    preferredLocale: input.preferredLocale,
    emergencyContact: input.emergencyName
      ? {
          name: input.emergencyName,
          relationship: input.emergencyRelationship ?? undefined,
          phone: normalizePhone(input.emergencyPhone, countryCode) ?? input.emergencyPhone ?? undefined,
        }
      : null,
    referralSource: input.referralSource,
    referredBy: input.referredBy,
    administrativeNotes: input.administrativeNotes,
    assignedProviderId: input.assignedProviderId,
  };
}

export type CreatePatientResult =
  | { status: "created"; id: string; patientNumber: string }
  | { status: "duplicates"; candidates: DuplicateCandidate[] };

export async function createPatient(
  ctx: ClinicContext,
  input: PatientInput,
  opts: { confirmNotDuplicate?: boolean } = {},
): Promise<CreatePatientResult> {
  requirePermission(ctx, "patient.create");
  const row = toRow(input, ctx.organization.countryCode);
  return tenantTx(ctx, async (tx) => {
    if (!opts.confirmNotDuplicate) {
      const candidates = await findDuplicates(tx, row);
      if (candidates.length) return { status: "duplicates", candidates };
    }
    const n = await nextCounter(tx, ctx.organizationId, "patient");
    const patientNumber = `P-${String(n).padStart(6, "0")}`;
    const [created] = await tx
      .insert(patients)
      .values({ ...row, communicationPrefs: { transactionalAllowed: input.messagesOptOut !== true }, organizationId: ctx.organizationId, patientNumber, createdByUserId: ctx.userId })
      .returning({ id: patients.id });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: "patient.created",
      entityType: "patient",
      entityId: created!.id,
      patientId: created!.id,
      metadata: { duplicateWarningOverridden: Boolean(opts.confirmNotDuplicate) },
    });
    return { status: "created", id: created!.id, patientNumber };
  });
}

export { ConflictError } from "@/server/errors";
import { ConflictError } from "@/server/errors";

/** Optimistic locking: fails with ConflictError if another user saved first. */
export async function updatePatient(ctx: ClinicContext, id: string, input: PatientInput, expectedVersion: number) {
  requirePermission(ctx, "patient.update");
  const row = toRow(input, ctx.organization.countryCode);
  return tenantTx(ctx, async (tx) => {
    const updated = await tx
      .update(patients)
      .set({
        ...row,
        ...(input.messagesOptOut === undefined ? {} : {
          // Merge so marketing consent evidence in the same JSON is never lost.
          communicationPrefs: sql`${patients.communicationPrefs} || ${JSON.stringify({ transactionalAllowed: !input.messagesOptOut })}::jsonb`,
        }),
        updatedAt: new Date(),
        version: sql`${patients.version} + 1`,
      })
      .where(and(eq(patients.id, id), eq(patients.version, expectedVersion)))
      .returning({ id: patients.id });
    if (!updated.length) throw new ConflictError();
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: "patient.updated",
      entityType: "patient",
      entityId: id,
      patientId: id,
      metadata: { fields: Object.keys(row) },
    });
  });
}

export async function setPatientArchived(ctx: ClinicContext, id: string, archived: boolean) {
  requirePermission(ctx, "patient.archive");
  return tenantTx(ctx, async (tx) => {
    await tx
      .update(patients)
      .set({ status: archived ? "archived" : "active", updatedAt: new Date(), version: sql`${patients.version} + 1` })
      .where(eq(patients.id, id));
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: archived ? "patient.archived" : "patient.restored",
      entityType: "patient",
      entityId: id,
      patientId: id,
    });
  });
}

export async function addPatientAlert(
  ctx: ClinicContext,
  patientId: string,
  input: { kind: "medical" | "allergy" | "medication" | "administrative"; severity: "info" | "warning" | "critical"; label: string; details: string | null },
) {
  requirePermission(ctx, "patient.alerts.manage");
  return tenantTx(ctx, async (tx) => {
    const [alert] = await tx
      .insert(patientAlerts)
      .values({ ...input, organizationId: ctx.organizationId, patientId, createdByUserId: ctx.userId })
      .returning({ id: patientAlerts.id });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: "patient.alert.added",
      entityType: "patient_alert",
      entityId: alert!.id,
      patientId,
    });
  });
}

export async function resolvePatientAlert(ctx: ClinicContext, alertId: string) {
  requirePermission(ctx, "patient.alerts.manage");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx
      .update(patientAlerts)
      .set({ resolvedAt: new Date(), resolvedByUserId: ctx.userId })
      .where(and(eq(patientAlerts.id, alertId), isNull(patientAlerts.resolvedAt)))
      .returning({ patientId: patientAlerts.patientId });
    if (row)
      await audit(tx, {
        organizationId: ctx.organizationId,
        actorType: "staff",
        actorUserId: ctx.userId,
        action: "patient.alert.resolved",
        entityType: "patient_alert",
        entityId: alertId,
        patientId: row.patientId,
      });
    return row?.patientId ?? null;
  });
}
