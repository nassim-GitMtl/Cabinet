import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";

export const SURFACES = [
  "mesial",
  "distal",
  "occlusal",
  "buccal",
  "lingual",
  "palatal",
  "incisal",
] as const;

export const ARCHES = ["maxillary", "mandibular"] as const;
export const QUADRANTS = ["upper_right", "upper_left", "lower_left", "lower_right"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .enum(values)
    .optional()
    .or(z.literal("").transform(() => undefined))
    .transform((value) => value ?? null);

/** FDI permanent teeth 11–48 and primary teeth 51–85. */
export function isFdiTooth(value: string): boolean {
  if (!/^\d{2}$/.test(value)) return false;
  const quadrant = Number(value[0]);
  const position = Number(value[1]);
  return quadrant >= 1 && quadrant <= 8 && position >= 1 && position <= (quadrant <= 4 ? 8 : 5);
}

export const performedProcedureInputSchema = z.object({
  serviceId: z.uuid("required"),
  branchId: z.uuid("required"),
  performingProviderId: z.uuid("required"),
  serviceDate: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const parsed = parseDateOnly(value);
      if (!parsed) ctx.addIssue({ code: "custom", message: "invalidDate" });
      return parsed ?? value;
    }),
  quantity: z.coerce.number().int().min(1, "invalidQuantity").max(99, "invalidQuantity"),
  unitPriceMinor: z.number().int().min(0, "invalidAmount"),
  priceOverrideReason: optionalText(500),
  toothNumber: optionalText(2).superRefine((value, ctx) => {
    if (value && !isFdiTooth(value)) ctx.addIssue({ code: "custom", message: "invalidTooth" });
  }),
  surfaces: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(SURFACES)).max(SURFACES.length))
    .transform((values) => [...new Set(values)]),
  arch: optionalEnum(ARCHES),
  quadrant: optionalEnum(QUADRANTS),
});

export type PerformedProcedureInput = z.infer<typeof performedProcedureInputSchema>;

export const procedureStatusInputSchema = z.object({
  status: z.enum(["reversed", "entered_in_error"]),
  reason: z.string().trim().min(1, "required").max(500),
});

export type ProcedureStatusInput = z.infer<typeof procedureStatusInputSchema>;
