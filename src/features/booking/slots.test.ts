import { describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/dates";
import { freeSlots } from "./slots";

const tz = "Africa/Algiers";
const hours = [
  { weekday: 3, startTime: "08:00:00", endTime: "12:00:00" },
  { weekday: 3, startTime: "13:00:00", endTime: "17:00:00" },
];
const at = (t: string) => zonedToUtc("2026-11-18", t, tz); // a Wednesday

describe("freeSlots", () => {
  it("returns slots inside working hours that fit the duration", () => {
    const slots = freeSlots({ date: "2026-11-18", timeZone: tz, hours, busy: [], durationMin: 30, notBefore: at("00:00") });
    expect(slots[0]).toBe("08:00");
    expect(slots).toContain("11:30");
    expect(slots).not.toContain("11:45"); // would end 12:15, after the morning interval
    expect(slots).not.toContain("12:00"); // lunch break
    expect(slots).toContain("16:30");
  });
  it("excludes busy intervals and times before the notice period", () => {
    const slots = freeSlots({
      date: "2026-11-18",
      timeZone: tz,
      hours,
      busy: [{ start: at("09:00"), end: at("10:00") }],
      durationMin: 30,
      notBefore: at("08:30"),
    });
    expect(slots).not.toContain("08:00");
    expect(slots).toContain("08:30");
    expect(slots).not.toContain("08:45"); // overlaps 09:00
    expect(slots).not.toContain("09:30");
    expect(slots).toContain("10:00");
  });
  it("has no slots on a non-working day", () => {
    expect(freeSlots({ date: "2026-11-20", timeZone: tz, hours, busy: [], durationMin: 30, notBefore: at("00:00") })).toEqual([]);
  });
});
