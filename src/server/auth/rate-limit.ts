import "server-only";

import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";

export const AUTH_RATE_LIMITS = {
  staff_login: { attempts: 30, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  patient_login: { attempts: 30, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  password_reset: { attempts: 10, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
} as const;

export type AuthRateLimitScope = keyof typeof AUTH_RATE_LIMITS;
export type AuthRateLimitResult = { allowed: boolean; retryAfterSeconds: number };

function secret(): string {
  const value = process.env.AUTH_RATE_LIMIT_SECRET
    || process.env.MFA_ENCRYPTION_KEY
    || (process.env.NODE_ENV === "production" ? undefined : process.env.DATABASE_URL);
  if (!value || (process.env.NODE_ENV === "production" && value.length < 32)) {
    throw new Error("AUTH_RATE_LIMIT_SECRET must contain at least 32 characters in production");
  }
  return value;
}

function fingerprint(ipAddress: string | null): string {
  return createHmac("sha256", secret()).update(ipAddress ?? "unknown-client").digest("hex");
}

/** Atomically consumes one request from a shared PostgreSQL throttle bucket. */
export async function consumeAuthRateLimit(
  scope: AuthRateLimitScope,
  ipAddress: string | null,
  database: Database = db,
): Promise<AuthRateLimitResult> {
  const rows = await database.execute<{ allowed: boolean; retry_after_seconds: number }>(
    sql`select * from app_private.consume_auth_rate_limit(${scope}, ${fingerprint(ipAddress)})`,
  );
  const row = rows[0];
  if (!row) throw new Error("Authentication rate limiter returned no result");
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}
