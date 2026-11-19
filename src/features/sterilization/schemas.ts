import { z } from "zod";

const required = z.string().trim().min(1, "required");
const uuid = z.string().uuid("required");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate");
const optionalNumber = (max: number) => z.union([z.literal(""), z.coerce.number().min(0).max(max)]).transform((value) => value === "" ? null : String(value));

export const indicatorResults = ["not_used", "pending", "pass", "fail"] as const;

export const createSterilizerSchema = z.object({
  branchId: uuid,
  name: required.max(120, "tooLong"),
  serialNumber: z.string().trim().max(120, "tooLong").transform((value) => value || null),
});

export const createInstrumentSetSchema = z.object({
  code: required.max(40, "tooLong"),
  name: required.max(120, "tooLong"),
  contents: z.string().trim().max(1_000, "tooLong").transform((value) => value || null),
});

export const recordCycleSchema = z.object({
  branchId: uuid,
  sterilizerId: uuid,
  reference: required.max(100, "tooLong"),
  program: required.max(120, "tooLong"),
  startedDate: dateOnly,
  startedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "invalidTime"),
  temperatureC: optionalNumber(200),
  pressureBar: optionalNumber(10),
  holdMinutes: optionalNumber(999),
  chemicalIndicator: z.enum(indicatorResults),
  airRemovalTest: z.enum(indicatorResults),
  biologicalIndicator: z.enum(indicatorResults),
  notes: z.string().trim().max(1_000, "tooLong").transform((value) => value || null),
  packs: z.array(z.object({
    instrumentSetId: z.union([uuid, z.literal("")]).transform((value) => value || null),
    label: z.string().trim().max(160, "tooLong").transform((value) => value || null),
    expiresOn: z.union([dateOnly, z.literal("")]).transform((value) => value || null),
    quantity: z.coerce.number().int().min(1, "sterilization.errors.packQuantity").max(50, "sterilization.errors.packQuantity"),
  }).refine((pack) => pack.instrumentSetId || pack.label, "sterilization.errors.packDescription"))
    .min(1, "sterilization.errors.packsRequired").max(100, "sterilization.errors.tooManyPacks"),
});

export const cycleDecisionSchema = z.object({
  cycleId: uuid,
  reason: z.string().trim().max(500, "tooLong").transform((value) => value || null),
});

export const requiredCycleDecisionSchema = z.object({ cycleId: uuid, reason: required.max(500, "tooLong") });
export const biologicalResultSchema = z.object({ cycleId: uuid, result: z.enum(["pass", "fail"]), reason: z.string().trim().max(500, "tooLong").transform((value) => value || null) });
export const discardPackSchema = z.object({ packId: uuid, cycleId: uuid, reason: required.max(500, "tooLong") });
export const linkPackSchema = z.object({ packId: uuid, patientId: uuid, performedProcedureId: z.union([uuid, z.literal("")]).transform((value) => value || null), usedOn: dateOnly });
export const voidPackUseSchema = z.object({ useId: uuid, reason: required.max(500, "tooLong") });

export type CreateSterilizerInput = z.infer<typeof createSterilizerSchema>;
export type CreateInstrumentSetInput = z.infer<typeof createInstrumentSetSchema>;
export type RecordCycleInput = z.infer<typeof recordCycleSchema> & { startedAt: Date };
