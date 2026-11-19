/** How a new patient heard of the clinic (§6, §19). Shared by the DB enum, forms and the acquisition report. */
export const ACQUISITION_CHANNELS = [
  "facebook", "instagram", "tiktok", "google", "word_of_mouth", "patient_referral",
  "doctor_referral", "walk_in", "partner", "other",
] as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

export function isAcquisitionChannel(value: unknown): value is AcquisitionChannel {
  return typeof value === "string" && (ACQUISITION_CHANNELS as readonly string[]).includes(value);
}
