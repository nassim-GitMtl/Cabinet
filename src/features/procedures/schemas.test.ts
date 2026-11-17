import { describe, expect, it } from "vitest";
import { isFdiTooth, performedProcedureInputSchema } from "./schemas";

describe("performed procedure validation", () => {
  it("accepts permanent and primary FDI tooth numbers", () => {
    for (const tooth of ["11", "18", "28", "38", "48", "51", "65", "75", "85"]) {
      expect(isFdiTooth(tooth), tooth).toBe(true);
    }
    for (const tooth of ["10", "19", "49", "56", "86", "1", "abc"]) {
      expect(isFdiTooth(tooth), tooth).toBe(false);
    }
  });

  it("parses a date-only value and de-duplicates selected surfaces", () => {
    const result = performedProcedureInputSchema.parse({
      serviceId: "019acccc-1111-7111-8111-111111111111",
      branchId: "019acccc-2222-7222-8222-222222222222",
      performingProviderId: "019acccc-3333-7333-8333-333333333333",
      serviceDate: "17/11/2026",
      quantity: "2",
      unitPriceMinor: 150000,
      toothNumber: "26",
      surfaces: "mesial,occlusal,mesial",
      arch: "",
      quadrant: "",
      priceOverrideReason: "",
    });
    expect(result.serviceDate).toBe("2026-11-17");
    expect(result.quantity).toBe(2);
    expect(result.surfaces).toEqual(["mesial", "occlusal"]);
    expect(result.priceOverrideReason).toBeNull();
  });

  it("rejects invalid quantity, date, tooth, and surface codes", () => {
    const result = performedProcedureInputSchema.safeParse({
      serviceId: "019acccc-1111-7111-8111-111111111111",
      branchId: "019acccc-2222-7222-8222-222222222222",
      performingProviderId: "019acccc-3333-7333-8333-333333333333",
      serviceDate: "31/02/2026",
      quantity: "0",
      unitPriceMinor: 1,
      toothNumber: "19",
      surfaces: "unknown",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
        expect.arrayContaining(["serviceDate", "quantity", "toothNumber", "surfaces.0"]),
      );
    }
  });
});
