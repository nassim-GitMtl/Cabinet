import "server-only";
import { sql } from "drizzle-orm";
import { normalizePhone } from "@/lib/phone";
import { consumeAuthRateLimit } from "@/server/auth/rate-limit";
import { db } from "@/server/db/client";
import { sendOperatorEmail } from "@/server/mail";

/**
 * Public "try it free" requests. They are platform data, not clinic data: written only through
 * app_private.submit_trial_request and read only by the platform operator (see src/features/platform/server.ts).
 */
export type TrialRequestInput = {
  clinicName: string; contactName: string; phone: string; email: string; city: string | null;
  practitioners: number | null; message: string | null; locale: "fr" | "en" | "ar";
};

export class TrialRequestError extends Error {
  constructor(public readonly code: "tooMany" | "invalid", public readonly fields: Record<string, string> = {}) { super(code); }
}

/** Field errors keyed like the form (message keys under trial.errors). Empty = valid. */
export function trialRequestErrors(input: TrialRequestInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const len = (v: string | null | undefined) => (v ?? "").trim().length;
  if (len(input.clinicName) < 2 || len(input.clinicName) > 160) errors.clinicName = "required";
  if (len(input.contactName) < 2 || len(input.contactName) > 120) errors.contactName = "required";
  if (!normalizePhone(input.phone, "DZ")) errors.phone = "invalidPhone";
  if (!/^\S+@\S+\.\S+$/.test(input.email.trim()) || len(input.email) > 200) errors.email = "invalidEmail";
  if (len(input.city) > 120) errors.city = "tooLong";
  if (input.practitioners !== null && (!Number.isInteger(input.practitioners) || input.practitioners < 1 || input.practitioners > 100)) errors.practitioners = "invalidQuantity";
  if (len(input.message) > 1000) errors.message = "tooLong";
  return errors;
}

export async function submitTrialRequest(input: TrialRequestInput, ipAddress: string | null): Promise<string> {
  const fields = trialRequestErrors(input);
  if (Object.keys(fields).length) throw new TrialRequestError("invalid", fields);
  const rate = await consumeAuthRateLimit("trial_request", ipAddress);
  if (!rate.allowed) throw new TrialRequestError("tooMany");
  const phone = normalizePhone(input.phone, "DZ")!;
  const rows = await db.execute<{ id: string }>(sql`select app_private.submit_trial_request(
    ${input.clinicName}, ${input.contactName}, ${phone}, ${input.email}, ${input.city ?? ""}, ${input.practitioners}::int,
    ${input.message ?? ""}, ${input.locale}) as id`);
  const id = rows[0]!.id;
  // Best effort: the request is saved whatever happens to the email.
  await sendOperatorEmail(
    `Demande d'essai : ${input.clinicName.trim()}`,
    [`Cabinet : ${input.clinicName.trim()}`, `Contact : ${input.contactName.trim()}`, `Téléphone : ${phone}`, `Email : ${input.email.trim()}`,
      `Ville : ${input.city?.trim() || "-"}`, `Praticiens : ${input.practitioners ?? "-"}`, "", input.message?.trim() || "", "",
      "Voir /platform pour créer le cabinet d'essai."].join("\n"),
  ).catch(() => false);
  return id;
}
