import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const patientInputSchema = z
  .object({
    firstName: z.string().trim().min(1, "required").max(100),
    lastName: z.string().trim().min(1, "required").max(100),
    firstNameAr: optionalText(100),
    lastNameAr: optionalText(100),
    sex: z.enum(["female", "male", "other", "undisclosed"]).optional().or(z.literal("").transform(() => undefined)),
    birthDate: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const parsed = parseDateOnly(v);
        if (!parsed) ctx.addIssue({ code: "custom", message: "invalidDate" });
        return parsed;
      }),
    birthDatePrecision: z.enum(["exact", "year", "estimated"]).default("exact"),
    phone: optionalText(40),
    phoneAlt: optionalText(40),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.email("invalidEmail").nullable()),
    addressLine: optionalText(300),
    city: optionalText(100),
    region: optionalText(100),
    preferredLocale: z.enum(["fr", "en", "ar"]).default("fr"),
    emergencyName: optionalText(150),
    emergencyRelationship: optionalText(80),
    emergencyPhone: optionalText(40),
    referralSource: optionalText(150),
    referredBy: optionalText(150),
    administrativeNotes: optionalText(2000),
    assignedProviderId: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid().nullable()),
  })
  .superRefine((v, ctx) => {
    if (v.birthDate && v.birthDate > new Date().toISOString().slice(0, 10)) {
      ctx.addIssue({ code: "custom", path: ["birthDate"], message: "futureDate" });
    }
  });

export type PatientInput = z.infer<typeof patientInputSchema>;

export const alertInputSchema = z.object({
  kind: z.enum(["medical", "allergy", "medication", "administrative"]),
  severity: z.enum(["info", "warning", "critical"]),
  label: z.string().trim().min(1, "required").max(200),
  details: optionalText(2000),
});
