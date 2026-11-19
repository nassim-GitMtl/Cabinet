import { describe, expect, it } from "vitest";
import { isValidSlug, mergeWeeklyHours, safeHttpsUrl, slugify } from "./helpers";
import { qrSvg } from "./qr";

describe("public page helpers", () => {
  it("builds valid URL names from clinic names", () => {
    expect(slugify("Cabinet Démo Les Oliviers (fictif)")).toBe("cabinet-demo-les-oliviers-fictif");
    expect(slugify("  Dr. Aït-Saïd  ")).toBe("dr-ait-said");
    expect(isValidSlug(slugify("Cabinet Démo Les Oliviers (fictif)"))).toBe(true);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("-cabinet")).toBe(false);
    expect(isValidSlug("cab--inet")).toBe(false);
    expect(isValidSlug("Cabinet")).toBe(false);
  });

  it("accepts only https links", () => {
    expect(safeHttpsUrl("https://maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
    expect(safeHttpsUrl("http://example.com")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("https://localhost")).toBeNull();
    expect(safeHttpsUrl("")).toBeNull();
  });

  it("merges clinicians' hours into clinic opening hours per weekday", () => {
    const hours = mergeWeeklyHours([
      { weekday: 7, start: "08:00:00", end: "12:00:00" },
      { weekday: 7, start: "13:00:00", end: "17:00:00" },
      { weekday: 7, start: "09:00:00", end: "13:00:00" },
      { weekday: 1, start: "14:00:00", end: "18:00:00" },
    ]);
    expect(hours[7]).toEqual([{ start: "08:00", end: "17:00" }]);
    expect(hours[1]).toEqual([{ start: "14:00", end: "18:00" }]);
    expect(hours[5]).toEqual([]);
  });

  it("renders a scannable SVG QR code", async () => {
    const svg = await qrSvg("https://cabinet.example/c/cabinet-test");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
  });
});
