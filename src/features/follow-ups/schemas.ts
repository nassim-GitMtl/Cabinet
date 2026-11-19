import { z } from "zod";
import { CONTACT_CHANNELS, CONTACT_OUTCOMES, FOLLOW_UP_REASONS, MAX_TEMPLATE_LENGTH, MESSAGE_LOCALES } from "./messages";

const uuid = z.uuid();
// Buttons send null for "no appointment/plan"; forms would send "".
const optionalUuid = z.string().trim().nullish().transform((v) => v || null).pipe(uuid.nullable());

export const logContactSchema = z
  .object({
    patientId: uuid,
    reason: z.enum(FOLLOW_UP_REASONS),
    channel: z.enum(CONTACT_CHANNELS),
    outcome: z.enum(CONTACT_OUTCOMES),
    appointmentId: optionalUuid,
    treatmentPlanId: optionalUuid,
    visitDate: z.union([z.iso.date(), z.literal("")]).transform((v) => v || null).nullish(),
    installmentId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null).nullish(),
    note: z.string().trim().max(300, "tooLong").nullish().transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    const needsAppointment = v.reason === "appointment_reminder" || v.reason === "no_show";
    const needsPlan = v.reason === "treatment_followup" || v.reason === "estimate_followup";
    const needsVisit = v.reason === "after_visit";
    const needsInstallment = v.reason === "installment_due";
    if (needsAppointment !== Boolean(v.appointmentId) || needsPlan !== Boolean(v.treatmentPlanId) || needsVisit !== Boolean(v.visitDate)
      || needsInstallment !== Boolean(v.installmentId)) {
      ctx.addIssue({ code: "custom", message: "followUps.errors.referenceUnavailable" });
    }
  });
export type LogContactInput = z.infer<typeof logContactSchema>;

export const followUpSettingsSchema = z.object({
  recallMonths: z.coerce.number().int().min(3, "followUps.errors.recallMonths").max(24, "followUps.errors.recallMonths"),
  templates: z.object(
    Object.fromEntries(FOLLOW_UP_REASONS.map((reason) => [reason, z.object(
      Object.fromEntries(MESSAGE_LOCALES.map((locale) => [locale, z.string().trim().max(MAX_TEMPLATE_LENGTH, "tooLong")])),
    )])),
  ) as unknown as z.ZodType<Record<(typeof FOLLOW_UP_REASONS)[number], Record<(typeof MESSAGE_LOCALES)[number], string>>>,
  branchPhones: z.array(z.object({ branchId: uuid, phone: z.string().trim().max(40, "tooLong") })).max(50),
  reviewUrl: z.string().trim().max(500, "tooLong"),
  aftercare: z.array(z.object({
    categoryId: uuid,
    fr: z.string().trim().max(500, "tooLong"), en: z.string().trim().max(500, "tooLong"), ar: z.string().trim().max(500, "tooLong"),
  })).max(100),
});
export type FollowUpSettingsInput = z.infer<typeof followUpSettingsSchema>;
