import { afterEach, describe, expect, it } from "vitest";
import { isRegistrationAllowed } from "@/server/deployment/registration";
import { makeClinic } from "../support/factories";

describe("clinic-server registration mode", () => {
  const original = process.env.REGISTRATION_MODE;
  afterEach(() => {
    process.env.REGISTRATION_MODE = original;
  });

  it("first-only closes self-registration once a clinic exists; closed never allows it", async () => {
    await makeClinic("Cabinet Serveur Local");
    process.env.REGISTRATION_MODE = "first-only";
    expect(await isRegistrationAllowed()).toBe(false);
    process.env.REGISTRATION_MODE = "closed";
    expect(await isRegistrationAllowed()).toBe(false);
    process.env.REGISTRATION_MODE = "open";
    expect(await isRegistrationAllowed()).toBe(true);
  });
});
