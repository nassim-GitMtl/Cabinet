import { describe, expect, it } from "vitest";
import { applyBasisPoints, formatMoney, minorToInput, parseMoneyInput, sumMoney } from "./money";

describe("money", () => {
  it("parses common French/Algerian inputs into minor units without floats", () => {
    expect(parseMoneyInput("1500", "DZD")).toBe(150000);
    expect(parseMoneyInput("1 500,50", "DZD")).toBe(150050);
    expect(parseMoneyInput("1.500,5", "DZD")).toBe(150050);
    expect(parseMoneyInput("2500.75", "DZD")).toBe(250075);
    expect(parseMoneyInput("1.500", "DZD")).toBe(150000); // thousands separator, not decimals
    expect(parseMoneyInput("0,1", "DZD")).toBe(10);
    expect(parseMoneyInput("abc", "DZD")).toBeNull();
    expect(parseMoneyInput("", "DZD")).toBeNull();
  });
  it("formats with the configured symbol", () => {
    expect(formatMoney(150050, "DZD", "fr-DZ", "DA").replace(/\s/g, " ")).toBe("1 500,50 DA");
  });
  it("round-trips input values", () => {
    expect(minorToInput(150005, "DZD")).toBe("1500.05");
    expect(parseMoneyInput(minorToInput(-42, "DZD"), "DZD")).toBe(-42);
  });
  it("refuses to sum mixed currencies", () => {
    expect(sumMoney([{ amountMinor: 1, currency: "DZD" }], "DZD").amountMinor).toBe(1);
    expect(() => sumMoney([{ amountMinor: 1, currency: "EUR" }], "DZD")).toThrow();
  });
  it("applies basis points with half-away-from-zero rounding", () => {
    expect(applyBasisPoints(1005, 1000)).toBe(101); // 100.5 -> 101
    expect(applyBasisPoints(-1005, 1000)).toBe(-101);
  });
});
