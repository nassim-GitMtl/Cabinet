import "server-only";
import { and, asc, eq, isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ClinicContext } from "./auth/context";
import type { Tx } from "./db/client";
import { branches } from "./db/schema";

/**
 * Sites (branches) of a clinic. The "main" site is the first one created: rows from before multi-site have no site
 * and count as the main site's. The current site is the one the user picked in the app (cookie, re-checked here),
 * otherwise the main site.
 */
export const SITE_COOKIE = "cdp_site";

export async function mainSiteId(tx: Tx): Promise<string> {
  const [b] = await tx.select({ id: branches.id }).from(branches).orderBy(asc(branches.createdAt), asc(branches.id)).limit(1);
  if (!b) throw new Error("clinic without a site");
  return b.id;
}

export async function currentSiteId(tx: Tx, ctx: Pick<ClinicContext, "siteId">): Promise<string> {
  if (ctx.siteId) {
    const [b] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, ctx.siteId), eq(branches.isActive, true))).limit(1);
    if (b) return b.id;
  }
  return mainSiteId(tx);
}

/** Rows of one site; for the main site also the rows recorded before sites existed (no site). */
export function ofSite(column: AnyPgColumn, siteId: string, mainId: string): SQL {
  return siteId === mainId ? or(eq(column, siteId), isNull(column))! : eq(column, siteId);
}
