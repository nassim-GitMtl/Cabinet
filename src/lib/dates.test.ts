import { describe, expect, it } from "vitest";
import { ageOn, formatDateOnly, parseDateOnly, todayInZone } from "./dates";

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
});
