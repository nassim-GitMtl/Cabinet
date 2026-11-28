import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingLink, getPublicBookingInfo } from "@/features/booking/server";
import { createPatient } from "@/features/patients/server";
import {
  convertPlatformClinicToPaid, extendPlatformTrial, listPlatformClinics, listTrialRequests, provisionPlatformClinic,
  setPlatformClinicModules, setTrialRequestStatus,
} from "@/features/platform/server";
import { getProcedureEntrySupport } from "@/features/procedures/server";
import { runAutoReminders, setAutoReminders } from "@/features/reminders/server";
import { submitTrialRequest, type TrialRequestInput } from "@/features/trials/server";
import { addDays, todayInZone, zonedToUtc } from "@/lib/dates";
import { BILLABLE_MODULES } from "@/server/authz/modules";
import { db } from "@/server/db/client";
import { appointments, branches, organizations, trialRequests, users } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import type { SendResult, WhatsAppConfig } from "@/server/whatsapp";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const DAY = 86_400_000;
const randomIp = () => `198.51.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const request = (over: Partial<TrialRequestInput> = {}): TrialRequestInput => ({
  clinicName: "Cabinet Essai Hydra", contactName: "Dr Amel Essai", phone: "0550 12 34 56", email: `essai-${randomUUID()}@example.test`,
  city: "Alger", practitioners: 2, message: "Démonstration le matin", locale: "fr", ...over,
});
const patientInput = (firstName: string, phone: string | null) => ({
  firstName, lastName: "Essai", firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null,
  birthDatePrecision: "exact" as const, phone, phoneAlt: null, email: null, addressLine: null, city: null, region: null,
  preferredLocale: "fr" as const, emergencyName: null, emergencyRelationship: null, emergencyPhone: null,
  referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
});

async function operator() {
  const home = await makeClinic("Essai Operateur");
  await db.update(users).set({ platformRole: "operator" }).where(eq(users.id, home.userId));
  return { userId: home.userId, fullName: "Operator", email: home.user.email };
}

const setTrialEnd = (organizationId: string, trialEndsAt: Date | null) =>
  withDbContext({ organizationId, actorType: "system" }, (tx) => tx.update(organizations).set({ trialEndsAt }).where(eq(organizations.id, organizationId)));

describe("free trials", () => {
  it("turns a trial request into a trial clinic, then extends it and converts it to paid", async () => {
    const ctx = await operator();
    const now = new Date();
    const requestId = await submitTrialRequest(request(), randomIp());
    const inbox = await listTrialRequests(ctx);
    expect(inbox.find((r) => r.id === requestId)).toMatchObject({ status: "new", phone: "+213550123456", practitioners: 2, city: "Alger" });

    // Every module the console offers can be given, including the ones added after the console (regression: 0045's list).
    const created = await provisionPlatformClinic(ctx, {
      clinicName: "Cabinet Essai Hydra", kind: "solo", ownerFullName: "Dr Amel Essai", email: `owner-${randomUUID()}@example.test`,
      ownerIsDentist: true, locale: "fr", modules: [...BILLABLE_MODULES], trialDays: 30, requestId,
    }, now);
    let clinic = (await listPlatformClinics(ctx)).find((c) => c.id === created.organizationId)!;
    expect(clinic.enabledModules).toEqual(["core", ...BILLABLE_MODULES]);
    expect(clinic.trialEndsAt!.getTime()).toBe(now.getTime() + 30 * DAY);
    expect(clinic.usage).toEqual({ patients: 0, appointments30d: 0, invoices30d: 0, lastActivityAt: null });
    expect((await listTrialRequests(ctx)).find((r) => r.id === requestId)).toMatchObject({ status: "converted", convertedOrganizationId: created.organizationId });

    // Usage counts follow what the team really does (counts only).
    const owner = contextFor({ userId: created.userId, organizationId: created.organizationId }, "owner");
    await createPatient(owner, patientInput("Usage", null), { confirmNotDuplicate: true });
    clinic = (await listPlatformClinics(ctx)).find((c) => c.id === created.organizationId)!;
    expect(clinic.usage).toMatchObject({ patients: 1, lastActivityAt: expect.any(Date) });

    // Extending adds to the running trial; once over, it restarts from today.
    expect((await extendPlatformTrial(ctx, created.organizationId, 14, now)).getTime()).toBe(now.getTime() + 44 * DAY);
    await setTrialEnd(created.organizationId, new Date(now.getTime() - DAY));
    expect((await extendPlatformTrial(ctx, created.organizationId, 7, now)).getTime()).toBe(now.getTime() + 7 * DAY);
    await expect(extendPlatformTrial(ctx, created.organizationId, 0)).rejects.toMatchObject({ code: "invalidTrialDays" });
    await expect(extendPlatformTrial(ctx, created.organizationId, 121)).rejects.toMatchObject({ code: "invalidTrialDays" });

    await convertPlatformClinicToPaid(ctx, created.organizationId);
    clinic = (await listPlatformClinics(ctx)).find((c) => c.id === created.organizationId)!;
    expect(clinic.trialEndsAt).toBeNull();

    // Without a trial length the clinic is paid from the start.
    const paid = await provisionPlatformClinic(ctx, {
      clinicName: "Cabinet Payant", kind: "solo", ownerFullName: "Owner", email: `paid-${randomUUID()}@example.test`,
      ownerIsDentist: true, locale: "fr", modules: ["billing"], trialDays: null,
    });
    expect((await listPlatformClinics(ctx)).find((c) => c.id === paid.organizationId)!.trialEndsAt).toBeNull();
    await setPlatformClinicModules(ctx, paid.organizationId, ["whatsapp_reminders", "multi_site"]);
    const [stored] = await withDbContext({ organizationId: paid.organizationId, actorType: "system" }, (tx) =>
      tx.select({ enabledModules: organizations.enabledModules }).from(organizations).where(eq(organizations.id, paid.organizationId)));
    expect(stored!.enabledModules).toEqual(["core", "whatsapp_reminders", "multi_site"]);
  });

  it("checks the public form, throttles it, and shows requests to the operator only", async () => {
    await expect(submitTrialRequest(request({ phone: "12", email: "nope", clinicName: " " }), randomIp())).rejects.toMatchObject({
      code: "invalid", fields: { phone: "invalidPhone", email: "invalidEmail", clinicName: "required" },
    });
    const ip = randomIp();
    for (let i = 0; i < 5; i++) await submitTrialRequest(request(), ip);
    await expect(submitTrialRequest(request(), ip)).rejects.toMatchObject({ code: "tooMany" });

    const clinic = await makeClinic("Essai Curieux");
    const ordinary = { userId: clinic.userId, fullName: "Owner", email: clinic.user.email };
    await expect(listTrialRequests(ordinary)).rejects.toThrow();
    const id = await submitTrialRequest(request(), randomIp());
    await expect(setTrialRequestStatus(ordinary, id, "declined")).rejects.toThrow();
    await expect(extendPlatformTrial(ordinary, clinic.organizationId, 30)).rejects.toThrow();
    await expect(convertPlatformClinicToPaid(ordinary, clinic.organizationId)).rejects.toThrow();
    // The application login cannot read the table directly, inside a clinic or not.
    await expectDbError(withDbContext({ organizationId: clinic.organizationId, userId: clinic.userId, actorType: "staff" }, (tx) => tx.select().from(trialRequests)), /permission denied/);
    await expectDbError(db.execute(sql`select count(*) from trial_requests`), /permission denied/);

    const ctx = await operator();
    await setTrialRequestStatus(ctx, id, "contacted");
    expect((await listTrialRequests(ctx)).find((r) => r.id === id)).toMatchObject({ status: "contacted", convertedOrganizationId: null });
    await expect(setTrialRequestStatus(ctx, randomUUID(), "contacted")).rejects.toMatchObject({ code: "requestUnavailable" });
  });

  it("stops online booking and automatic reminders once the trial is over, and resumes them when extended", async () => {
    const ctx = await makeClinic("Essai Termine");
    const token = await createBookingLink(ctx, "Site web");
    expect(await getPublicBookingInfo(token)).not.toBeNull();

    await withDbContext({ organizationId: ctx.organizationId, actorType: "system" }, (tx) =>
      tx.update(organizations).set({ enabledModules: sql`array_append(${organizations.enabledModules}, 'whatsapp_reminders')` }).where(eq(organizations.id, ctx.organizationId)));
    const support = await getProcedureEntrySupport(ctx);
    const branchId = support.branches[0]!.id;
    await withDbContext({ organizationId: ctx.organizationId, actorType: "system" }, (tx) => tx.update(branches).set({ phone: "+213550000099" }).where(eq(branches.id, branchId)));
    await setAutoReminders(ctx, true);
    const patient = await createPatient(ctx, patientInput("Rappel", "0661009988"), { confirmNotDuplicate: true });
    if (patient.status !== "created") throw new Error("fixture");
    const tz = ctx.organization.timezone;
    const startsAt = zonedToUtc(addDays(todayInZone(tz), 1), "10:00", tz);
    await withDbContext({ organizationId: ctx.organizationId, actorType: "system" }, (tx) => tx.insert(appointments).values({
      organizationId: ctx.organizationId, branchId, patientId: patient.id, providerId: support.providers[0]!.id, startsAt,
      endsAt: new Date(startsAt.getTime() + 1_800_000), createdByUserId: ctx.userId,
    }));

    const ours: string[] = [];
    const config: WhatsAppConfig = { token: "t", phoneNumberId: "1234567890", version: "v26.0", template: "rappel_rendez_vous", languages: ["fr"] };
    const send = async (_c: WhatsAppConfig, input: { toE164: string }): Promise<SendResult> => {
      if (input.toE164 === "+213661009988") ours.push(input.toE164);
      return { ok: true, providerMessageId: `wamid.${randomUUID()}` };
    };

    await setTrialEnd(ctx.organizationId, new Date(Date.now() - 60_000));
    expect(await getPublicBookingInfo(token)).toBeNull();
    await runAutoReminders({ send, config });
    expect(ours).toEqual([]);

    await setTrialEnd(ctx.organizationId, new Date(Date.now() + 7 * DAY));
    expect(await getPublicBookingInfo(token)).not.toBeNull();
    await runAutoReminders({ send, config });
    expect(ours).toEqual(["+213661009988"]);
  });
});
