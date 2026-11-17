/**
 * Timestamps are stored in UTC (timestamptz) and displayed in the clinic
 * timezone. Date-only values (birth date, service date) are ISO "YYYY-MM-DD"
 * strings and are NEVER converted through a timezone.
 */

export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function formatDateTime(value: Date | string, timeZone: string, locale = "fr-DZ"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Today's calendar date in the clinic timezone as YYYY-MM-DD. */
export function todayInZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Age in whole years from a date-only birth date, evaluated on `onDate` (YYYY-MM-DD). */
export function ageOn(birthDate: string, onDate: string): number | null {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = onDate.split("-").map(Number);
  if (!by || !bm || !bd || !y || !m || !d) return null;
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age >= 0 ? age : null;
}

/** Parses DD/MM/YYYY (or YYYY-MM-DD) into an ISO date-only string; null if invalid. */
export function parseDateOnly(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (fr) [d, m, y] = [Number(fr[1]), Number(fr[2]), Number(fr[3])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
