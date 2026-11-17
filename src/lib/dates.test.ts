import { describe, expect, it } from "vitest";
import { addDays, ageOn, formatDateOnly, isoWeekday, parseDateOnly, timeInZone, todayInZone, zonedToUtc } from "./dates";

describe("dates", () => {
  it("parses DD/MM/YYYY and rejects impossible dates", () => {
    expect(parseDateOnly("12/04/1990")).toBe("1990-04-12");
    expect(parseDateOnly("1990-04-12")).toBe("1990-04-12");
    expect(parseDateOnly("31/02/2020")).toBeNull();
  });
  it("formats date-only values without timezone shifts", () => {
    expect(formatDateOnly("2026-01-01")).toBe("01/01/2026");
  });
  it("computes age on a given day", () => {
    expect(ageOn("2000-11-18", "2026-11-17")).toBe(25);
    expect(ageOn("2000-11-17", "2026-11-17")).toBe(26);
  });
  it("uses the clinic timezone for 'today'", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Algiers (UTC+1).
    expect(todayInZone("Africa/Algiers", new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
  it("converts clinic wall-clock times to UTC and back", () => {
    const utc = zonedToUtc("2026-11-17", "09:30", "Africa/Algiers");
    expect(utc.toISOString()).toBe("2026-11-17T08:30:00.000Z");
    expect(timeInZone(utc, "Africa/Algiers")).toBe("09:30");
    // DST-observing zone: Paris in summer is UTC+2.
    expect(zonedToUtc("2026-07-01", "09:00", "Europe/Paris").toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });
  it("computes ISO weekdays and adds days across months", () => {
    expect(isoWeekday("2026-11-15")).toBe(7); // Sunday
    expect(isoWeekday("2026-11-16")).toBe(1); // Monday
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});
