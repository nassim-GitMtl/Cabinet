import { describe, expect, it } from "vitest";
import { periodMonths } from "./acquisition";

describe("acquisition report periods", () => {
  it("lists whole months ending with the current one, across year boundaries", () => {
    expect(periodMonths("2026-02-15", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(periodMonths("2026-11-19", 12)[0]).toBe("2025-12");
    expect(periodMonths("2026-11-19", 6)).toHaveLength(6);
  });
});
