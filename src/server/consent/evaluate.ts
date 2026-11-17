import type { ShareCategory } from "../db/schema/consent";

/**
 * Pure decision function for cross-clinic shared-profile reads. It is the
 * single source of truth used by every shared-data path (pages, APIs, file
 * URLs, thumbnails, exports, background jobs). Callers must log the outcome in
 * `shared_access_events`.
 */

export type GrantSnapshot = {
  id: string;
  receivingOrganizationId: string;
  networkPatientId: string;
  status: "active" | "expired" | "revoked" | "superseded";
  categories: readonly string[];
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;
  includeFutureUpdates: boolean;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type SharedAccessRequest = {
  organizationId: string;
  organizationVerified: boolean;
  networkPatientId: string;
  category: ShareCategory;
  /** Clinical date of the record being read (YYYY-MM-DD). */
  recordDate: string;
  /** When the source record was created; used for the future-updates rule. */
  recordCreatedAt: Date;
  /** Staff member holds `shared_profile.read` in this organization. */
  actorHasPermission: boolean;
  now: Date;
};

export type SharedAccessDecision =
  | { allowed: true; grantId: string }
  | {
      allowed: false;
      reason:
        | "no_permission"
        | "organization_unverified"
        | "no_active_grant"
        | "category_not_granted"
        | "outside_date_range"
        | "future_updates_not_granted";
    };

export function evaluateSharedAccess(
  grants: readonly GrantSnapshot[],
  req: SharedAccessRequest,
): SharedAccessDecision {
  if (!req.actorHasPermission) return { allowed: false, reason: "no_permission" };
  if (!req.organizationVerified) return { allowed: false, reason: "organization_unverified" };

  const active = grants.filter(
    (g) =>
      g.receivingOrganizationId === req.organizationId &&
      g.networkPatientId === req.networkPatientId &&
      g.status === "active" &&
      g.revokedAt === null &&
      (g.expiresAt === null || g.expiresAt.getTime() > req.now.getTime()),
  );
  if (active.length === 0) return { allowed: false, reason: "no_active_grant" };

  const withCategory = active.filter((g) => g.categories.includes(req.category));
  if (withCategory.length === 0) return { allowed: false, reason: "category_not_granted" };

  const inRange = withCategory.filter(
    (g) =>
      (g.dateFrom === null || req.recordDate >= g.dateFrom) &&
      (g.dateTo === null || req.recordDate <= g.dateTo),
  );
  if (inRange.length === 0) return { allowed: false, reason: "outside_date_range" };

  const match = inRange.find(
    (g) => g.includeFutureUpdates || req.recordCreatedAt.getTime() <= g.grantedAt.getTime(),
  );
  if (!match) return { allowed: false, reason: "future_updates_not_granted" };
  return { allowed: true, grantId: match.id };
}
