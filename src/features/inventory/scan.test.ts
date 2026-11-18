import { describe, expect, it } from "vitest";
import { parseInventoryScan } from "./scan";

describe("parseInventoryScan", () => {
  it("extracts GTIN, expiry and lot from human-readable GS1", () => {
    expect(parseInventoryScan("]C1(01)01234567890128(17)271231(10)LOT-42")).toEqual({
      raw: "(01)01234567890128(17)271231(10)LOT-42",
      productCode: "01234567890128",
      expiresOn: "2027-12-31",
      lotNumber: "LOT-42",
      gs1: true,
    });
  });

  it("extracts compact GS1 and treats day 00 as month end", () => {
    expect(parseInventoryScan("01012345678901281727020010BATCH9")).toMatchObject({
      productCode: "01234567890128",
      expiresOn: "2027-02-28",
      lotNumber: "BATCH9",
      gs1: true,
    });
  });

  it("keeps ordinary barcodes and rejects impossible GS1 expiry dates", () => {
    expect(parseInventoryScan("  6131234567890  ")).toMatchObject({ productCode: "6131234567890", gs1: false });
    expect(parseInventoryScan("(01)01234567890128(17)271332(10)L1").expiresOn).toBeNull();
  });
});
