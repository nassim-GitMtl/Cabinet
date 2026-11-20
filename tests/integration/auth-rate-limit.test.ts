import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { requestPasswordResetEmail } from "@/server/auth/password-reset";
import { AUTH_RATE_LIMITS, consumeAuthRateLimit } from "@/server/auth/rate-limit";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { authenticatePatient } from "@/server/portal/auth";
import { authenticate } from "@/server/services/auth";
import { makeClinic } from "../support/factories";

describe("per-IP authentication rate limits", () => {
  it("atomically permits the configured burst, then blocks a shared database bucket", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const limit = AUTH_RATE_LIMITS.staff_login.attempts;
    for (let i = 0; i < limit - 1; i++) {
      expect((await consumeAuthRateLimit("staff_login", ip)).allowed).toBe(true);
    }
    // Race only the two requests at the boundary: the row lock must admit exactly one.
    const boundary = await Promise.all([
      consumeAuthRateLimit("staff_login", ip),
      consumeAuthRateLimit("staff_login", ip),
    ]);
    expect(boundary.filter((result) => result.allowed)).toHaveLength(1);
    const blocked = boundary.find((result) => !result.allowed);
    expect(blocked?.retryAfterSeconds).toBeGreaterThan(0);
    expect((await consumeAuthRateLimit("staff_login", ip)).allowed).toBe(false);

    // A different authentication surface and address have independent budgets.
    expect((await consumeAuthRateLimit("patient_login", ip)).allowed).toBe(true);
    expect((await consumeAuthRateLimit("staff_login", "203.0.113.99")).allowed).toBe(true);
  });

  it("protects staff login, portal login and forgot-password before expensive account work", async () => {
    const ctx = await makeClinic("Cabinet Rate Limit");
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, ctx.userId));
    const octet = Number.parseInt(randomUUID().slice(0, 2), 16);
    const staffIp = `198.18.0.${octet}`;
    const patientIp = `198.18.1.${octet}`;
    const resetIp = `198.18.2.${octet}`;

    for (let i = 0; i < AUTH_RATE_LIMITS.staff_login.attempts; i++) {
      await consumeAuthRateLimit("staff_login", staffIp);
    }
    expect(await authenticate(owner!.email, "correct-horse-battery", staffIp)).toEqual({ ok: false, reason: "rateLimited" });

    for (let i = 0; i < AUTH_RATE_LIMITS.patient_login.attempts; i++) {
      await consumeAuthRateLimit("patient_login", patientIp);
    }
    expect(await authenticatePatient("unknown@example.test", "any-password", patientIp))
      .toEqual({ ok: false, reason: "rateLimited" });

    for (let i = 0; i < AUTH_RATE_LIMITS.password_reset.attempts; i++) {
      await consumeAuthRateLimit("password_reset", resetIp);
    }
    const send = vi.fn(async () => undefined);
    await requestPasswordResetEmail(owner!.email, { baseUrl: "https://clinic.example", send }, resetIp);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps raw addresses out of storage and denies the app role direct bucket access", async () => {
    const rawIp = "192.0.2.123";
    await consumeAuthRateLimit("password_reset", rawIp);
    const admin = postgres(process.env.TEST_DATABASE_URL_ADMIN!, { max: 1 });
    try {
      const [privilege] = await admin<{ can_select: boolean; can_update: boolean }[]>`
        select has_table_privilege('cabinet_app', 'public.auth_rate_limits', 'SELECT') as can_select,
               has_table_privilege('cabinet_app', 'public.auth_rate_limits', 'UPDATE') as can_update`;
      expect(privilege).toEqual({ can_select: false, can_update: false });
      const rows = await admin<{ key_hash: string }[]>`
        select key_hash from public.auth_rate_limits where scope = 'password_reset'`;
      expect(rows.some((row) => row.key_hash === rawIp)).toBe(false);
      expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.key_hash))).toBe(true);
    } finally {
      await admin.end();
    }
  });
});
