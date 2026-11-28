import { randomUUID } from "node:crypto";
import type { ClinicContext } from "@/server/auth/context";
import { ROLE_TEMPLATES, type RoleTemplateKey } from "@/server/authz/permissions";
import { PRODUCT_MODULES } from "@/server/authz/modules";
import { registerClinic } from "@/server/services/onboarding";
import { NO_TRIAL } from "@/lib/trial";

/** Creates an isolated clinic tenant and returns a staff context for it. */
export async function makeClinic(name = "Cabinet Test", role: RoleTemplateKey = "owner"): Promise<ClinicContext> {
  const email = `owner-${randomUUID()}@example.test`;
  const { userId, organizationId } = await registerClinic({
    clinicName: name,
    kind: "solo",
    ownerFullName: "Dr Test",
    email,
    password: "correct-horse-battery",
    ownerIsDentist: true,
    locale: "fr",
  });
  return contextFor({ userId, organizationId, name }, role);
}

/** Same user/org but with another role's permission set (for permission tests). */
export function contextFor(
  base: { userId: string; organizationId: string; name?: string },
  role: RoleTemplateKey,
): ClinicContext {
  return {
    sessionId: "test",
    userId: base.userId,
    user: { id: base.userId, fullName: "Test", email: "t@example.test", locale: "fr", platformRole: "none" },
    organizationId: base.organizationId,
    membershipId: randomUUID(),
    siteId: null,
    sites: [],
    displayName: "Test",
    roleKey: role,
    roleName: ROLE_TEMPLATES[role].name,
    permissions: ROLE_TEMPLATES[role].permissions,
    readOnlyCopy: false,
    trial: NO_TRIAL,
    canManageClinicComputer: ROLE_TEMPLATES[role].permissions.includes("org.settings.manage"),
    organization: {
      id: base.organizationId,
      name: base.name ?? "Cabinet",
      defaultCurrency: "DZD",
      defaultLocale: "fr",
      timezone: "Africa/Algiers",
      countryCode: "DZ",
      verificationStatus: "unverified",
      enabledModules: [...PRODUCT_MODULES],
      settings: {},
    },
  };
}

/** Asserts a query failed with the given PostgreSQL error (drizzle wraps it in `cause`). */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (err as Error).message;
    if (!pattern.test(message)) throw new Error(`Expected DB error ${pattern}, got: ${message}`);
    return;
  }
  throw new Error(`Expected DB error ${pattern}, but the query succeeded`);
}

/**
 * Network identities are created by verified-linking flows (patient context).
 * Tests create them with the schema-owner connection.
 */
export async function makeNetworkPatient(): Promise<string> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.TEST_DATABASE_URL_ADMIN!, { max: 1 });
  try {
    const [row] = await sql<{ id: string }[]>`insert into network_patients default values returning id`;
    return row!.id;
  } finally {
    await sql.end();
  }
}
