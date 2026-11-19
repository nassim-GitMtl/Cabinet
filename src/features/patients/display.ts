import { ageOn, formatDateOnly, todayInZone } from "@/lib/dates";

export function patientDisplayName(p: { firstName: string; lastName: string }) {
  return `${p.lastName.toUpperCase()} ${p.firstName}`;
}

export function patientArabicName(p: { firstNameAr: string | null; lastNameAr: string | null }) {
  return [p.lastNameAr, p.firstNameAr].filter(Boolean).join(" ") || null;
}

export function patientAge(
  p: { birthDate: string | null; birthDatePrecision?: string | null },
  timeZone: string,
): { age: number; approximate: boolean } | null {
  if (!p.birthDate) return null;
  const age = ageOn(p.birthDate, todayInZone(timeZone));
  return age === null ? null : { age, approximate: p.birthDatePrecision !== "exact" && p.birthDatePrecision != null };
}

/** Values used to prefill the patient form from a stored record. */
export function patientFormDefaults(p: {
  firstName: string;
  lastName: string;
  firstNameAr: string | null;
  lastNameAr: string | null;
  sex: string | null;
  birthDate: string | null;
  birthDatePrecision: string | null;
  phone: string | null;
  phoneAlt: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  preferredLocale: string;
  communicationPrefs?: { transactionalAllowed?: boolean } | null;
  emergencyContact: { name: string; relationship?: string; phone?: string } | null;
  referralSource: string | null;
  referredBy: string | null;
  administrativeNotes: string | null;
  assignedProviderId: string | null;
}): Record<string, string> {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    firstNameAr: p.firstNameAr ?? "",
    lastNameAr: p.lastNameAr ?? "",
    sex: p.sex ?? "",
    birthDate: formatDateOnly(p.birthDate),
    birthDatePrecision: p.birthDatePrecision ?? "exact",
    phone: p.phone ?? "",
    phoneAlt: p.phoneAlt ?? "",
    email: p.email ?? "",
    addressLine: p.addressLine ?? "",
    city: p.city ?? "",
    region: p.region ?? "",
    preferredLocale: p.preferredLocale,
    messagesOptOut: p.communicationPrefs?.transactionalAllowed === false ? "on" : "",
    emergencyName: p.emergencyContact?.name ?? "",
    emergencyRelationship: p.emergencyContact?.relationship ?? "",
    emergencyPhone: p.emergencyContact?.phone ?? "",
    referralSource: p.referralSource ?? "",
    referredBy: p.referredBy ?? "",
    administrativeNotes: p.administrativeNotes ?? "",
    assignedProviderId: p.assignedProviderId ?? "",
  };
}
