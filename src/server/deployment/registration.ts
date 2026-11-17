import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

/**
 * REGISTRATION_MODE controls self-service clinic sign-up:
 * - "open" (default, cloud/SaaS): anyone may register a clinic;
 * - "first-only" (clinic server): only until the first clinic exists;
 * - "closed": never (accounts come from staff invitations).
 */
export type RegistrationMode = "open" | "first-only" | "closed";

export function registrationMode(): RegistrationMode {
  const v = process.env.REGISTRATION_MODE;
  return v === "first-only" || v === "closed" ? v : "open";
}

export async function isRegistrationAllowed(): Promise<boolean> {
  const mode = registrationMode();
  if (mode === "open") return true;
  if (mode === "closed") return false;
  const rows = await db.execute<{ n: string }>(sql`select app_private.organization_count()::text as n`);
  return Number(rows[0]?.n ?? 0) === 0;
}
