import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

/** Normalizes a phone number to E.164 using the clinic's default country. */
export function normalizePhone(input: string | null | undefined, defaultCountry = "DZ"): string | null {
  if (!input?.trim()) return null;
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry as CountryCode);
  return parsed?.isValid() ? parsed.number : null;
}

export function formatPhone(e164: string | null | undefined, defaultCountry = "DZ"): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === defaultCountry ? parsed.formatNational() : parsed.formatInternational();
}
