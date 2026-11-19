import { describe, expect, it } from "vitest";
import { code128Bars, encodeCode128B } from "./code128";

describe("Code 128 B pack labels", () => {
  it("encodes the data, checksum and stop symbol", () => {
    const encoded = encodeCode128B("ST-2026-000001");
    expect(encoded[0]).toBe(104);
    expect(encoded.at(-2)).toBe(80);
    expect(encoded.at(-1)).toBe(106);
    expect(code128Bars("ST-2026-000001").bars.length).toBeGreaterThan(30);
  });

  it("rejects non-printable or non-ASCII text", () => {
    expect(() => encodeCode128B("ST-é")).toThrow(/ASCII/);
  });
});
