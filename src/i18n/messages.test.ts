import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

const keys = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe("translations", () => {
  it("en and ar define exactly the same keys as fr", () => {
    const base = keys(fr).sort();
    expect(keys(en).sort()).toEqual(base);
    expect(keys(ar).sort()).toEqual(base);
  });
});
