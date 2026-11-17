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

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Converts a clinic wall-clock date ("YYYY-MM-DD") + time ("HH:MM") to a UTC Date. */
export function zonedToUtc(date: string, timeHHMM: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = timeHHMM.split(":").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let utc = guess - zoneOffsetMs(guess, timeZone);
  // Second pass handles DST transitions.
  utc = guess - zoneOffsetMs(utc, timeZone);
  return new Date(utc);
}

/** Wall-clock "HH:MM" of an instant in the clinic timezone. */
export function timeInZone(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a date-only string. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Adds days to a date-only string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
