import { describe, expect, it } from "vitest";
import {
  buildNeonRuntimeUrl,
  databasePoolMax,
  isNeonDatabaseUrl,
  isPooledNeonUrl,
  normalizeDatabaseUrl,
  redactDatabaseUrl,
  validateNeonAdminUrl,
} from "./database-url";

const direct = "postgresql://neondb_owner:owner-secret@ep-green-field-a1b2c3.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

describe("database deployment URLs", () => {
  it("builds a TLS pooled runtime URL using the restricted role", () => {
    const url = new URL(buildNeonRuntimeUrl(direct, "a-very-long-runtime-password"));
    expect(url.hostname).toBe("ep-green-field-a1b2c3-pooler.us-east-2.aws.neon.tech");
    expect(url.username).toBe("cabinet_app");
    expect(url.password).toBe("a-very-long-runtime-password");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.has("channel_binding")).toBe(false);
  });

  it("normalizes unsupported channel binding without weakening TLS", () => {
    const url = new URL(normalizeDatabaseUrl(direct));
    expect(url.searchParams.has("channel_binding")).toBe(false);
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("recognizes Neon direct and pooled endpoints", () => {
    const pooled = buildNeonRuntimeUrl(direct, "a-very-long-runtime-password");
    expect(isNeonDatabaseUrl(direct)).toBe(true);
    expect(isPooledNeonUrl(direct)).toBe(false);
    expect(isPooledNeonUrl(pooled)).toBe(true);
    expect(isNeonDatabaseUrl("postgres://user:pass@localhost:5432/db")).toBe(false);
  });

  it("rejects an unsafe admin connection", () => {
    const pooled = buildNeonRuntimeUrl(direct, "a-very-long-runtime-password");
    expect(() => validateNeonAdminUrl(pooled)).toThrow(/direct Neon endpoint/);
    expect(() => validateNeonAdminUrl("postgres://owner:pass@localhost/db?sslmode=require")).toThrow(/Neon host/);
    expect(() => validateNeonAdminUrl(direct.replace("sslmode=require", "sslmode=disable"))).toThrow(/sslmode=require/);
  });

  it("redacts passwords and validates pool sizes", () => {
    expect(redactDatabaseUrl(direct)).not.toContain("owner-secret");
    expect(databasePoolMax(undefined)).toBe(10);
    expect(databasePoolMax("5")).toBe(5);
    expect(() => databasePoolMax("0")).toThrow(/between 1 and 20/);
    expect(() => databasePoolMax("many")).toThrow(/between 1 and 20/);
  });
});
