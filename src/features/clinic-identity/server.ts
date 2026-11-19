import "server-only";

import { createHash } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { normalizePhone } from "@/lib/phone";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { db } from "@/server/db/client";
import {
  bookingLinks, branches, clinicLogos, clinicPublicProfiles, legalEntities, MAX_LOGO_BYTES, memberships, organizations,
  type IssuerSnapshot,
} from "@/server/db/schema";
import { withDbContext } from "@/server/db/tenant";

export class ClinicIdentityError extends Error {
  constructor(public readonly code: string, public readonly field?: string) { super(code); }
}

/** Algerian legal identifiers printed on invoices (labels as printed). Empty ones are not printed. */
export const IDENTIFIER_KEYS = ["NIF", "NIS", "RC", "AI"] as const;

export type ClinicIdentityInput = {
  clinicName: string;
  legalName: string;
  address: string;
  identifiers: Record<(typeof IDENTIFIER_KEYS)[number], string>;
  phone: string;
  email: string;
};

const staff = (ctx: ClinicContext) => ({ organizationId: ctx.organizationId, actorType: "staff" as const, actorUserId: ctx.userId });

async function defaultEntities(tx: Parameters<Parameters<typeof tenantTx>[1]>[0]) {
  const [entity] = await tx.select().from(legalEntities).orderBy(sql`${legalEntities.isDefault} desc`, asc(legalEntities.createdAt)).limit(1);
  const [branch] = entity
    ? await tx.select().from(branches).where(and(eq(branches.legalEntityId, entity.id), eq(branches.isActive, true))).orderBy(asc(branches.createdAt)).limit(1)
    : [];
  return { entity: entity ?? null, branch: branch ?? null };
}

export async function getClinicIdentity(ctx: ClinicContext) {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    const { entity, branch } = await defaultEntities(tx);
    const [logo] = await tx.select({ sha256: clinicLogos.sha256, byteSize: clinicLogos.byteSize }).from(clinicLogos).limit(1);
    return { clinicName: ctx.organization.name, entity, branch, logo: logo ?? null };
  });
}

export async function saveClinicIdentity(ctx: ClinicContext, input: ClinicIdentityInput) {
  requirePermission(ctx, "org.settings.manage");
  const clinicName = input.clinicName.trim();
  const legalName = input.legalName.trim();
  if (clinicName.length < 2 || clinicName.length > 120) throw new ClinicIdentityError("clinicName", "clinicName");
  if (legalName.length < 2 || legalName.length > 160) throw new ClinicIdentityError("legalName", "legalName");
  if (input.address.trim().length > 300) throw new ClinicIdentityError("tooLong", "address");
  const identifiers: Record<string, string> = {};
  for (const key of IDENTIFIER_KEYS) {
    const value = (input.identifiers[key] ?? "").trim();
    if (value.length > 40) throw new ClinicIdentityError("tooLong", `identifiers.${key}`);
    if (value) identifiers[key] = value;
  }
  const phone = input.phone.trim() ? normalizePhone(input.phone, ctx.organization.countryCode) : null;
  if (input.phone.trim() && !phone) throw new ClinicIdentityError("invalidPhone", "phone");
  const email = input.email.trim() || null;
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ClinicIdentityError("invalidEmail", "email");

  return tenantTx(ctx, async (tx) => {
    const { entity, branch } = await defaultEntities(tx);
    if (!entity || !branch) throw new ClinicIdentityError("unavailable");
    await tx.update(organizations).set({ name: clinicName, updatedAt: new Date() }).where(eq(organizations.id, ctx.organizationId));
    await tx.update(legalEntities).set({ legalName, address: input.address.trim() || null, identifiers }).where(eq(legalEntities.id, entity.id));
    await tx.update(branches).set({ address: input.address.trim() || null, phone, email }).where(eq(branches.id, branch.id));
    // Identifiers are public mentions, but keep the audit to field names only.
    await audit(tx, { ...staff(ctx), action: "org.identity_updated", entityType: "organization", entityId: ctx.organizationId,
      metadata: { identifiers: Object.keys(identifiers), nameChanged: clinicName !== ctx.organization.name } });
  });
}

/** PNG, JPEG or WebP only (from magic bytes, never the browser's claim); SVG is refused (can carry scripts). */
export function detectLogoType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function saveClinicLogo(ctx: ClinicContext, bytes: Uint8Array) {
  requirePermission(ctx, "org.settings.manage");
  if (!bytes.length) throw new ClinicIdentityError("emptyFile", "logo");
  if (bytes.length > MAX_LOGO_BYTES) throw new ClinicIdentityError("logoTooLarge", "logo");
  const mimeType = detectLogoType(bytes);
  if (!mimeType) throw new ClinicIdentityError("logoType", "logo");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const values = { mimeType, bytes: Buffer.from(bytes), byteSize: bytes.length, sha256, updatedByUserId: ctx.userId, updatedAt: new Date() };
  return tenantTx(ctx, async (tx) => {
    await tx.insert(clinicLogos).values({ ...values, organizationId: ctx.organizationId })
      .onConflictDoUpdate({ target: clinicLogos.organizationId, set: values });
    await audit(tx, { ...staff(ctx), action: "org.logo_updated", entityType: "organization", entityId: ctx.organizationId, metadata: { byteSize: bytes.length } });
  });
}

export async function removeClinicLogo(ctx: ClinicContext) {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    await tx.delete(clinicLogos).where(eq(clinicLogos.organizationId, ctx.organizationId));
    await audit(tx, { ...staff(ctx), action: "org.logo_removed", entityType: "organization", entityId: ctx.organizationId });
  });
}

/** Live issuer details (drafts, estimates) and the logo version for printed documents. */
export async function getPrintBranding(ctx: ClinicContext): Promise<{ issuer: IssuerSnapshot | null; logoVersion: string | null }> {
  return tenantTx(ctx, async (tx) => {
    const { entity } = await defaultEntities(tx);
    const [row] = entity ? await tx.execute<{ s: IssuerSnapshot }>(sql`select app_private.issuer_snapshot_for(${entity.id}) as s`) : [];
    const [logo] = await tx.select({ sha256: clinicLogos.sha256 }).from(clinicLogos).limit(1);
    return { issuer: row?.s ?? null, logoVersion: logo?.sha256.slice(0, 12) ?? null };
  });
}

/** Logo bytes for one clinic: staff routes pass their own organization, the public page its resolved one. */
export async function loadClinicLogo(organizationId: string) {
  return withDbContext({ organizationId, actorType: "system" }, async (tx) => {
    const [logo] = await tx.select({ mimeType: clinicLogos.mimeType, bytes: clinicLogos.bytes, sha256: clinicLogos.sha256 }).from(clinicLogos).limit(1);
    return logo ?? null;
  });
}

/** Public page logo: only for a published page of an active clinic (same resolver as the page). */
export async function loadPublicClinicLogo(slug: string) {
  const [row] = await db.execute<{ organization_id: string }>(sql`select * from app_private.resolve_public_clinic(${slug.toLowerCase()})`);
  return row ? loadClinicLogo(row.organization_id) : null;
}

export type SetupItem = { key: "identity" | "phone" | "logo" | "team" | "booking" | "publicPage"; done: boolean; href: string };

/** First-setup checklist from real data (shown to clinic administrators until complete). */
export async function getSetupChecklist(ctx: ClinicContext): Promise<SetupItem[]> {
  requirePermission(ctx, "org.settings.manage");
  return tenantTx(ctx, async (tx) => {
    const { entity, branch } = await defaultEntities(tx);
    const [[logo], [team], [link], [page]] = await Promise.all([
      tx.select({ n: count() }).from(clinicLogos),
      tx.select({ n: count() }).from(memberships).where(eq(memberships.status, "active")),
      tx.select({ n: count() }).from(bookingLinks).where(eq(bookingLinks.isActive, true)),
      tx.select({ n: count() }).from(clinicPublicProfiles).where(eq(clinicPublicProfiles.isPublished, true)),
    ]);
    return [
      { key: "identity", done: Boolean(entity?.address && entity.identifiers?.NIF), href: "/settings/clinic" },
      { key: "phone", done: Boolean(branch?.phone), href: "/settings/clinic" },
      { key: "logo", done: Number(logo?.n) > 0, href: "/settings/clinic" },
      { key: "team", done: Number(team?.n) > 1, href: "/settings/team" },
      { key: "booking", done: Number(link?.n) > 0, href: "/agenda/requests" },
      { key: "publicPage", done: Number(page?.n) > 0, href: "/settings/public-page" },
    ];
  });
}
