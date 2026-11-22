import { describe, expect, it } from "vitest";
import { calculateHonorarium, isValidRule, percentInputToBasisPoints, resolveRule } from "./calculation";

const line = { unitPriceMinor: 1_000_000, quantity: 1, discountMinor: 0, labFeeMinor: 0, deductLabBeforeShare: false };

describe("practitioner fee calculation", () => {
  it("applies a percentage to the line amount", () => {
    expect(calculateHonorarium({ ...line, rule: { type: "percent", value: 3000 } })).toEqual({
      lineAmountMinor: 1_000_000, baseMinor: 1_000_000, physicianShareMinor: 300_000, clinicShareMinor: 700_000,
    });
  });

  it("takes the lab fee off the base only when the service says so", () => {
    const withLab = { ...line, labFeeMinor: 400_000, rule: { type: "percent", value: 5000 } as const };
    expect(calculateHonorarium({ ...withLab, deductLabBeforeShare: true })).toMatchObject({ baseMinor: 600_000, physicianShareMinor: 300_000, clinicShareMinor: 700_000 });
    expect(calculateHonorarium(withLab)).toMatchObject({ baseMinor: 1_000_000, physicianShareMinor: 500_000 });
  });

  it("applies discounts and caps fixed amounts at the base", () => {
    expect(calculateHonorarium({ ...line, quantity: 2, discountMinor: 200_000, rule: { type: "percent", value: 2500 } }))
      .toMatchObject({ lineAmountMinor: 1_800_000, physicianShareMinor: 450_000 });
    expect(calculateHonorarium({ ...line, quantity: 3, rule: { type: "fixed", value: 150_000 } })).toMatchObject({ physicianShareMinor: 450_000 });
    expect(calculateHonorarium({ ...line, rule: { type: "fixed", value: 5_000_000 } })).toMatchObject({ physicianShareMinor: 1_000_000, clinicShareMinor: 0 });
  });

  it("rounds once, half away from zero, and always balances", () => {
    const r = calculateHonorarium({ ...line, unitPriceMinor: 333, rule: { type: "percent", value: 1550 } });
    expect(r.physicianShareMinor).toBe(52);
    expect(r.physicianShareMinor + r.clinicShareMinor).toBe(r.lineAmountMinor);
  });

  it("resolves the most specific rule", () => {
    expect(resolveRule(null, null, 3000)).toEqual({ type: "percent", value: 3000 });
    expect(resolveRule(null, { type: "fixed", value: 100 }, 3000)).toEqual({ type: "fixed", value: 100 });
    expect(resolveRule({ type: "percent", value: 0 }, { type: "fixed", value: 100 }, 3000)).toEqual({ type: "percent", value: 0 });
  });

  it("validates rules and percentage input", () => {
    expect(isValidRule({ type: "percent", value: 10_001 })).toBe(false);
    expect(isValidRule({ type: "fixed", value: 10_001 })).toBe(true);
    expect(isValidRule({ type: "fixed", value: -1 })).toBe(false);
    expect(isValidRule({ type: "percent", value: 12.5 })).toBe(false);
    expect(percentInputToBasisPoints("30")).toBe(3000);
    expect(percentInputToBasisPoints("12,5")).toBe(1250);
    expect(percentInputToBasisPoints("100")).toBe(10_000);
    expect(percentInputToBasisPoints("100.01")).toBeNull();
    expect(percentInputToBasisPoints("")).toBeNull();
    expect(percentInputToBasisPoints("-5")).toBeNull();
  });
});
