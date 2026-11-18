import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
import { isFdiTooth, SURFACES } from "@/features/procedures/schemas";

export const FINDING_KINDS = [
  "caries", "existing_filling", "crown", "bridge", "missing", "implant",
  "root_canal", "fracture", "mobility", "other",
] as const;

const optionalUuid = z.string().trim().optional().transform((value) => value || null).pipe(z.uuid().nullable());

export const odontogramFindingSchema = z.object({
  toothNumber: z.string().trim().superRefine((value, ctx) => {
    if (!isFdiTooth(value)) ctx.addIssue({ code: "custom", message: "invalidTooth" });
  }),
  kind: z.enum(FINDING_KINDS),
  surfaces: z.string().optional().transform((value) => value ? value.split(",").filter(Boolean) : [])
    .pipe(z.array(z.enum(SURFACES)).max(SURFACES.length)).transform((values) => [...new Set(values)]),
  note: z.string().trim().max(1000, "tooLong").optional().transform((value) => value || null),
  observedOn: z.string().trim().transform((value, ctx) => {
    const parsed = parseDateOnly(value);
    if (!parsed) ctx.addIssue({ code: "custom", message: "invalidDate" });
    return parsed ?? value;
  }),
  providerId: z.uuid("required"),
  treatmentPlanItemId: optionalUuid,
  performedProcedureId: optionalUuid,
});

export const odontogramStatusSchema = z.object({
  status: z.enum(["resolved", "entered_in_error"]),
  reason: z.string().trim().min(1, "required").max(1000, "tooLong"),
});

export type OdontogramFindingInput = z.infer<typeof odontogramFindingSchema>;
export type OdontogramStatusInput = z.infer<typeof odontogramStatusSchema>;
