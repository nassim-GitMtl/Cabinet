import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPatient } from "@/features/patients/server";
import { getProcedureEntrySupport } from "@/features/procedures/server";
import { applyWhatsAppStatuses, getAutoReminders, runAutoReminders, setAutoReminders } from "@/features/reminders/server";
import { addDays, todayInZone, zonedToUtc } from "@/lib/dates";
import { ForbiddenError } from "@/server/auth/context";
import { appointments, branches, organizations, outboundMessages, patients } from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";
import type { SendResult, WhatsAppConfig } from "@/server/whatsapp";
import { contextFor, expectDbError, makeClinic } from "../support/factories";

const config: WhatsAppConfig = { token: "t", phoneNumberId: "1234567890", version: "v26.0", template: "rappel_rendez_vous", languages: ["fr", "ar"] };
const patientInput = (firstName: string, phone: string | null) => ({
  firstName, lastName: "Rappel", firstNameAr: null, lastNameAr: null, sex: undefined, birthDate: null,
  birthDatePrecision: "exact" as const, phone, phoneAlt: null, email: null, addressLine: null, city: null, region: null,
  preferredLocale: "ar" as const, emergencyName: null, emergencyRelationship: null, emergencyPhone: null,
  referralSource: null, referredBy: null, administrativeNotes: null, assignedProviderId: null,
});

/** A clinic with the module sold and switched on, a clinic phone, and three patients booked tomorrow at 10:00. */
async function setup(name: string) {
  const ctx = await makeClinic(name);
  const asSystem = <T,>(fn: Parameters<typeof withDbContext<T>>[1]) => withDbContext({ organizationId: ctx.organizationId, actorType: "system" }, fn);
  await asSystem((tx) => tx.update(organizations).set({ enabledModules: sql`array_append(${organizations.enabledModules}, 'whatsapp_reminders')` }).where(eq(organizations.id, ctx.organizationId)));
  const support = await getProcedureEntrySupport(ctx);
  const branchId = support.branches[0]!.id;
  await asSystem((tx) => tx.update(branches).set({ phone: "+213550000000" }).where(eq(branches.id, branchId)));
  const tz = ctx.organization.timezone;
  const today = todayInZone(tz);
  const at = (day: string, time: string) => zonedToUtc(day, time, tz);
  const patient = async (first: string, phone: string | null) => {
    const r = await createPatient(ctx, patientInput(first, phone), { confirmNotDuplicate: true });
    if (r.status !== "created") throw new Error("fixture");
    return r.id;
  };
  const book = (patientId: string, startsAt: Date) =>
    asSystem(async (tx) => (await tx.insert(appointments).values({ organizationId: ctx.organizationId, branchId, patientId, providerId: support.providers[0]!.id, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), createdByUserId: ctx.userId }).returning({ id: appointments.id }))[0]!.id);
  return { ctx, asSystem, branchId, today, tomorrow: addDays(today, 1), at, patient, book };
}

const messagesOf = (f: Awaited<ReturnType<typeof setup>>) => f.asSystem((tx) => tx.select().from(outboundMessages).orderBy(outboundMessages.createdAt));

describe("automatic WhatsApp reminders", () => {
  it("sends one reminder per booked appointment of tomorrow, never twice, never against the patient's choice", async () => {
    const f = await setup("Rappels Envoi");
    await setAutoReminders(f.ctx, true);
    const karim = await f.patient("Karim", "0661000001");
    const optedOut = await f.patient("Refus", "0661000002");
    await f.asSystem((tx) => tx.update(patients).set({ communicationPrefs: { transactionalAllowed: false } }).where(eq(patients.id, optedOut)));
    const noPhone = await f.patient("SansTel", null);
    const later = await f.patient("Apres", "0661000003");
    const appt = await f.book(karim, f.at(f.tomorrow, "10:00"));
    await f.book(optedOut, f.at(f.tomorrow, "11:00"));
    await f.book(noPhone, f.at(f.tomorrow, "12:00"));
    await f.book(later, f.at(addDays(f.tomorrow, 1), "10:00"));

    const sent: Array<{ to: string; language: string; params: string[] }> = [];
    const send = async (_c: WhatsAppConfig, input: { toE164: string; language: string; params: string[] }): Promise<SendResult> => {
      sent.push({ to: input.toE164, language: input.language, params: input.params });
      return { ok: true, providerMessageId: `wamid.${randomUUID()}` };
    };
    const first = await runAutoReminders({ send, config });
    expect(first).toMatchObject({ queued: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "+213661000001", language: "ar" });
    expect(sent[0]!.params[0]).toBe("Karim");
    expect(sent[0]!.params[3]).toBe("10:00");
    expect(sent[0]!.params[4]).toContain("55");

    // Running again (cron retry, second instance) sends nothing new.
    await runAutoReminders({ send, config });
    expect(sent).toHaveLength(1);

    // Moved to another time: a new reminder for the new time.
    await f.asSystem((tx) => tx.update(appointments).set({ startsAt: f.at(f.tomorrow, "15:00"), endsAt: f.at(f.tomorrow, "15:30") }).where(eq(appointments.id, appt)));
    await runAutoReminders({ send, config });
    expect(sent.map((s) => s.params[3])).toEqual(["10:00", "15:00"]);

    // Delivery receipts move the status forward only.
    const [message] = (await messagesOf(f)).filter((m) => m.params.time === "10:00");
    await applyWhatsAppStatuses([{ providerMessageId: message!.providerMessageId!, status: "read", at: new Date(), errorCode: null, errorTitle: null }]);
    await applyWhatsAppStatuses([{ providerMessageId: message!.providerMessageId!, status: "delivered", at: new Date(), errorCode: null, errorTitle: null }]);
    const [after] = await f.asSystem((tx) => tx.select().from(outboundMessages).where(eq(outboundMessages.id, message!.id)));
    expect(after).toMatchObject({ status: "read" });
    expect(after!.deliveredAt).not.toBeNull();
    await expectDbError(f.asSystem((tx) => tx.update(outboundMessages).set({ toE164: "+213600000000" }).where(eq(outboundMessages.id, message!.id))), /not rewritten/);
    await expectDbError(f.asSystem((tx) => tx.delete(outboundMessages).where(eq(outboundMessages.id, message!.id))), /permission denied/);

    const screen = await getAutoReminders(f.ctx);
    expect(screen).toMatchObject({ enabled: true, hasPhone: true });
    expect(screen.recent.length).toBe(2);
  });

  it("retries network failures, gives up on final ones, and stops when the appointment changes", async () => {
    const f = await setup("Rappels Echecs");
    await setAutoReminders(f.ctx, true);
    const a = await f.patient("Reseau", "0661000011");
    const b = await f.patient("Final", "0661000012");
    const c = await f.patient("Annule", "0661000013");
    await f.book(a, f.at(f.tomorrow, "09:00"));
    await f.book(b, f.at(f.tomorrow, "09:30"));
    const cancelled = await f.book(c, f.at(f.tomorrow, "10:30"));
    let calls = 0;
    const flaky = async (_c: WhatsAppConfig, input: { toE164: string }): Promise<SendResult> => {
      calls += 1;
      if (input.toE164.endsWith("12")) return { ok: false, code: "131026", title: "Undeliverable", retryable: false };
      if (input.toE164.endsWith("13")) return { ok: true, providerMessageId: `wamid.${randomUUID()}` };
      return calls < 3 ? { ok: false, code: "network", title: "down", retryable: true } : { ok: true, providerMessageId: `wamid.${randomUUID()}` };
    };
    // Queue everything, but cancel one appointment before its message is sent.
    await f.asSystem((tx) => tx.update(appointments).set({ schedulingStatus: "cancelled", cancellationReason: "x", cancelledAt: new Date() }).where(eq(appointments.id, cancelled)));
    await runAutoReminders({ send: flaky, config });
    let rows = await messagesOf(f);
    expect(rows.map((r) => r.toE164).sort()).toEqual(["+213661000011", "+213661000012"]);
    expect(rows.find((r) => r.toE164.endsWith("12"))).toMatchObject({ status: "failed", errorCode: "131026" });
    expect(rows.find((r) => r.toE164.endsWith("11"))).toMatchObject({ status: "queued", attempts: 1, errorCode: "network" });
    await runAutoReminders({ send: flaky, config });
    rows = await messagesOf(f);
    expect(rows.find((r) => r.toE164.endsWith("11"))).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("does nothing unless the module is sold, the clinic switched it on and the provider is configured", async () => {
    const f = await setup("Rappels Off");
    const p = await f.patient("Off", "0661000021");
    await f.book(p, f.at(f.tomorrow, "10:00"));
    const send = async (): Promise<SendResult> => { throw new Error("must not send"); };
    expect(await runAutoReminders({ send, config })).toMatchObject({ sent: 0 });
    await setAutoReminders(f.ctx, true);
    expect(await runAutoReminders({ send, config: null })).toMatchObject({ notConfigured: true, sent: 0 });
    expect(await messagesOf(f)).toEqual([]);

    // Without a clinic phone it cannot be switched on; reception cannot switch it at all.
    const g = await setup("Rappels Sans Tel");
    await g.asSystem((tx) => tx.update(branches).set({ phone: null }).where(eq(branches.id, g.branchId)));
    await expect(setAutoReminders(g.ctx, true)).rejects.toMatchObject({ code: "noClinicPhone" });
    const reception = contextFor({ userId: g.ctx.userId, organizationId: g.ctx.organizationId }, "receptionist");
    await expect(setAutoReminders(reception, false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getAutoReminders(reception)).rejects.toBeInstanceOf(ForbiddenError);

    // Another clinic's messages are invisible.
    const seen = await withDbContext({ organizationId: g.ctx.organizationId, actorType: "staff", userId: g.ctx.userId }, (tx) =>
      tx.select().from(outboundMessages).where(and(eq(outboundMessages.organizationId, f.ctx.organizationId))));
    expect(seen).toEqual([]);
  });
});
