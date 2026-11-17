import { addDays, isoWeekday, zonedToUtc } from "@/lib/dates";

export type Interval = { start: Date; end: Date };
export type WeeklyHours = { weekday: number; startTime: string; endTime: string };

/**
 * Free start times (clinic wall-clock "HH:MM") for one clinician on one date.
 * A slot must fit entirely inside one working interval, not overlap any busy
 * interval (booked appointments, time off) and start at/after `notBefore`.
 * Pure function: no I/O, unit-tested.
 */
export function freeSlots(opts: {
  date: string;
  timeZone: string;
  hours: WeeklyHours[];
  busy: Interval[];
  durationMin: number;
  notBefore: Date;
  stepMin?: number;
}): string[] {
  const step = opts.stepMin ?? 15;
  const wd = isoWeekday(opts.date);
  const out: string[] = [];
  for (const h of opts.hours.filter((x) => x.weekday === wd)) {
    const dayStart = zonedToUtc(opts.date, h.startTime.slice(0, 5), opts.timeZone).getTime();
    const dayEnd = zonedToUtc(opts.date, h.endTime.slice(0, 5), opts.timeZone).getTime();
    for (let s = dayStart; s + opts.durationMin * 60_000 <= dayEnd; s += step * 60_000) {
      const e = s + opts.durationMin * 60_000;
      if (s < opts.notBefore.getTime()) continue;
      if (opts.busy.some((b) => b.start.getTime() < e && b.end.getTime() > s)) continue;
      const minutes = Math.round((s - zonedToUtc(opts.date, "00:00", opts.timeZone).getTime()) / 60_000);
      out.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
    }
  }
  return [...new Set(out)].sort();
}

/** Dates from `from` (inclusive) for `days` days. */
export function dateRange(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}
