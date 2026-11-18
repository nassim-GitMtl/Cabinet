import { describe, expect, it } from "vitest";
import { odontogramFindingSchema } from "./schemas";

describe("odontogram finding validation", () => {
  it("accepts FDI anatomy and de-duplicates surfaces", () => {
    const parsed = odontogramFindingSchema.parse({
      toothNumber: "26", kind: "caries", surfaces: "mesial,occlusal,mesial",
      observedOn: "18/11/2026", providerId: "019acccc-1111-7111-8111-111111111111",
      treatmentPlanItemId: "", performedProcedureId: "", note: "À surveiller",
    });
    expect(parsed).toMatchObject({ toothNumber: "26", observedOn: "2026-11-18", surfaces: ["mesial", "occlusal"] });
    expect(parsed.treatmentPlanItemId).toBeNull();
  });

  it("rejects invalid teeth, dates and surface codes", () => {
    const result = odontogramFindingSchema.safeParse({
      toothNumber: "19", kind: "caries", surfaces: "unknown", observedOn: "31/02/2026",
      providerId: "019acccc-1111-7111-8111-111111111111",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(expect.arrayContaining(["toothNumber", "surfaces.0", "observedOn"]));
  });
});
