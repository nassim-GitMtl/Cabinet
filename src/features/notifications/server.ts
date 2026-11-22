import "server-only";

import { count, eq, inArray, sql } from "drizzle-orm";
import { todayInZone } from "@/lib/dates";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Permission } from "@/server/authz/permissions";
import { bookingRequests, sterilizationCycles } from "@/server/db/schema";
import type { OperationalNotification, OperationalNotificationKind } from "./types";

const notificationPermissions = [
  "appointment.read",
  "inventory.manage",
  "sterilization.manage",
  "sterilization.release",
] as const satisfies readonly Permission[];

/**
 * Lightweight, privacy-safe task counts for the persistent app shell.
 * No patient, clinical, or financial content leaves this service.
 */
export async function getOperationalNotifications(ctx: ClinicContext): Promise<OperationalNotification[]> {
  const firstAllowed = notificationPermissions.find((permission) => can(ctx, permission));
  if (!firstAllowed) return [];
  // Every caller must hold at least one notification-source permission. Each
  // source below is additionally gated by its own exact permission.
  requirePermission(ctx, firstAllowed);

  const today = todayInZone(ctx.organization.timezone);
  return tenantTx(ctx, async (tx) => {
    const bookingPromise = can(ctx, "appointment.read")
      ? tx
          .select({ count: count() })
          .from(bookingRequests)
          .where(inArray(bookingRequests.status, ["submitted", "under_review", "awaiting_information", "alternative_proposed"]))
      : Promise.resolve([]);

    const inventoryPromise = can(ctx, "inventory.manage")
      ? tx.execute<{ low: number; expiring: number; expired: number }>(sql`
          with lot_balances as (
            select l.item_id, l.id as lot_id, l.expires_on, coalesce(sum(m.quantity_delta), 0)::int as balance
              from inventory_lots l
              left join inventory_movements m on m.lot_id = l.id
             where l.organization_id = ${ctx.organizationId}::uuid
             group by l.item_id, l.id, l.expires_on
          ), item_stock as (
            select i.id, i.minimum_stock,
                   coalesce(sum(lb.balance) filter (where lb.expires_on is null or lb.expires_on >= ${today}::date), 0)::int as usable_stock
              from inventory_items i
              left join lot_balances lb on lb.item_id = i.id
             where i.organization_id = ${ctx.organizationId}::uuid and i.is_active
             group by i.id, i.minimum_stock
          )
          select
            (select count(*)::int from item_stock where minimum_stock > 0 and usable_stock <= minimum_stock) as low,
            (select count(*)::int from lot_balances where balance > 0 and expires_on >= ${today}::date and expires_on <= (${today}::date + 60)) as expiring,
            (select count(*)::int from lot_balances where balance > 0 and expires_on < ${today}::date) as expired
        `)
      : Promise.resolve([]);

    const sterilizationPromise = can(ctx, "sterilization.manage") || can(ctx, "sterilization.release")
      ? tx.select({ count: count() }).from(sterilizationCycles).where(eq(sterilizationCycles.status, "pending_release"))
      : Promise.resolve([]);

    const [bookingRows, inventoryRows, sterilizationRows] = await Promise.all([
      bookingPromise,
      inventoryPromise,
      sterilizationPromise,
    ]);
    const inventory = inventoryRows[0];
    const notifications: OperationalNotification[] = [];
    const add = (kind: OperationalNotificationKind, value: number, href: string, priority: OperationalNotification["priority"] = "attention") => {
      if (value > 0) notifications.push({ kind, count: value, href, priority });
    };

    add("bookingRequests", Number(bookingRows[0]?.count ?? 0), "/agenda/requests");
    add("inventoryExpired", Number(inventory?.expired ?? 0), "/inventory", "urgent");
    add("sterilizationPending", Number(sterilizationRows[0]?.count ?? 0), "/sterilization");
    add("inventoryLow", Number(inventory?.low ?? 0), "/inventory");
    add("inventoryExpiring", Number(inventory?.expiring ?? 0), "/inventory");
    return notifications;
  });
}
