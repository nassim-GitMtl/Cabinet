import { z } from "zod";
import { isFdiTooth } from "@/features/procedures/schemas";
import { parseDateOnly } from "@/lib/dates";

export const CLINICAL_FILE_CATEGORIES = [
  "intraoral_photo", "extraoral_photo", "radiograph", "scan", "referral",
  "prescription", "lab_report", "consent", "other",
] as const;

export const clinicalFileInputSchema = z.object({
  category: z.enum(CLINICAL_FILE_CATEGORIES),
  title: z.string().trim().max(200, "tooLong").optional().transform((value) => value || null),
  clinicalDate: z.string().trim().transform((value, ctx) => {
    const parsed = parseDateOnly(value);
    if (!parsed) ctx.addIssue({ code: "custom", message: "invalidDate" });
    return parsed ?? value;
  }),
  toothNumbers: z.string().optional().transform((value) => [...new Set((value ?? "").split(/[\s,;]+/).filter(Boolean))])
    .superRefine((values, ctx) => {
      if (values.length > 16 || values.some((value) => !isFdiTooth(value))) ctx.addIssue({ code: "custom", message: "clinicalFiles.errors.invalidTeeth" });
    }),
  compareToFileId: z.string().trim().optional().transform((value) => value || null).pipe(z.uuid().nullable()),
});

export type ClinicalFileInput = z.infer<typeof clinicalFileInputSchema>;
