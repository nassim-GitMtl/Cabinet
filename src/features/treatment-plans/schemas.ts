import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
import { ARCHES, isFdiTooth, QUADRANTS, SURFACES } from "@/features/procedures/schemas";

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable().optional().transform((value) => value ?? null);

export const treatmentPlanItemSchema = z.object({
  serviceId: z.uuid("required"),
  quantity: z.coerce.number().int().min(1, "invalidQuantity").max(99, "invalidQuantity"),
  toothNumber: z.string().trim().max(2).nullable().optional().transform((value) => value || null).superRefine((value, ctx) => {
    if (value && !isFdiTooth(value)) ctx.addIssue({ code: "custom", message: "invalidTooth" });
  }),
  surfaces: z.array(z.enum(SURFACES)).max(SURFACES.length).default([]).transform((values) => [...new Set(values)]),
  arch: optionalEnum(ARCHES),
  quadrant: optionalEnum(QUADRANTS),
});

export const treatmentPlanInputSchema = z.object({
  title: z.string().trim().min(1, "required").max(160),
  notes: z.string().trim().max(2000).optional().transform((value) => value || null),
  items: z.array(treatmentPlanItemSchema).min(1, "treatmentItemsRequired").max(50),
});

export type TreatmentPlanInput = z.infer<typeof treatmentPlanInputSchema>;

export const treatmentDecisionInputSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  decision: z.enum(["accepted", "declined"]),
  method: z.enum(["signed_in_clinic", "verbal", "other"]),
  note: z.string().trim().max(1000).optional().transform((value) => value || null),
});

export type TreatmentDecisionInput = z.infer<typeof treatmentDecisionInputSchema>;

export const treatmentConversionInputSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  branchId: z.uuid("required"),
  performingProviderId: z.uuid("required"),
  serviceDate: z.string().trim().transform((value, ctx) => {
    const parsed = parseDateOnly(value);
    if (!parsed) ctx.addIssue({ code: "custom", message: "invalidDate" });
    return parsed ?? value;
  }),
});

export type TreatmentConversionInput = z.infer<typeof treatmentConversionInputSchema>;
