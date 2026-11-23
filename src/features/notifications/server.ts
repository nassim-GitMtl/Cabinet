import "server-only";

import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { addDays, todayInZone, zonedToUtc } from "@/lib/dates";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import type { Permission } from "@/server/authz/permissions";
import { appointments, bookingRequests, sterilizationCycles } from "@/server/db/schema";
import type { OperationalNotification, OperationalNotificationKind } from "./types";

const notificationPermissions = [
  "appointment.read",
  "patient.followup",
  "invoice.create",
  "payment.read",
  "honorarium.pay",
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
  const todayStart = zonedToUtc(today, "00:00", ctx.organization.timezone);
  const tomorrowStart = zonedToUtc(addDays(today, 1), "00:00", ctx.organization.timezone);
  const followUpEnd = zonedToUtc(addDays(today, 7), "00:00", ctx.organization.timezone);
  return tenantTx(ctx, async (tx) => {
    const bookingPromise = can(ctx, "appointment.read")
      ? tx
          .select({ count: count() })
          .from(bookingRequests)
          .where(inArray(bookingRequests.status, ["submitted", "under_review", "awaiting_information", "alternative_proposed"]))
      : Promise.resolve([]);

    const receptionPromise = can(ctx, "appointment.read")
      ? tx
          .select({ count: count() })
          .from(appointments)
          .where(and(
            eq(appointments.schedulingStatus, "booked"),
            inArray(appointments.visitStatus, ["arrived", "waiting"]),
            gte(appointments.startsAt, todayStart),
            lt(appointments.startsAt, tomorrowStart),
          ))
      : Promise.resolve([]);

    // A compact, useful subset of the follow-up queue: booked appointments
    // still awaiting confirmation during the next seven clinic days.
    const followUpPromise = can(ctx, "patient.followup")
      ? tx
          .select({ count: count() })
          .from(appointments)
          .where(and(
            eq(appointments.schedulingStatus, "booked"),
            eq(appointments.confirmationStatus, "pending"),
            gte(appointments.startsAt, new Date()),
            lt(appointments.startsAt, followUpEnd),
          ))
      : Promise.resolve([]);

    const billingReadyPromise = can(ctx, "invoice.create")
      ? tx.execute<{ count: number }>(sql`
          select count(*)::int as count
            from performed_procedures pp
           where pp.organization_id = ${ctx.organizationId}::uuid
             and pp.status = 'completed'
             and not exists (
               select 1 from invoice_lines il
                where il.performed_procedure_id = pp.id and il.released = false
             )
        `)
      : Promise.resolve([]);

    const invoicePaymentsPromise = can(ctx, "payment.read")
      ? tx.execute<{ count: number }>(sql`
          select count(*)::int as count
            from invoices i
           where i.organization_id = ${ctx.organizationId}::uuid
             and i.status = 'issued'
             and i.due_date is not null and i.due_date <= ${today}::date
             and i.total_minor
                 - coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0)
                 - coalesce((select sum(cn.amount_minor) from credit_notes cn where cn.invoice_id = i.id), 0) > 0
        `)
      : Promise.resolve([]);

    const honorariaPromise = can(ctx, "honorarium.pay")
      ? tx.execute<{ count: number }>(sql`
          with payable_by_provider as (
            select he.provider_id,
                   coalesce(sum(case when i.total_minor > 0 then
                     round(he.physician_share_minor::numeric
                       * least(
                           greatest(coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0), 0),
                           greatest(i.total_minor - coalesce((select sum(cn.amount_minor) from credit_notes cn where cn.invoice_id = i.id), 0), 0)
                         ) / i.total_minor)
                     else he.physician_share_minor end), 0) as payable_minor
              from honorarium_entries he
              join invoices i on i.id = he.invoice_id
             where he.organization_id = ${ctx.organizationId}::uuid and i.status = 'issued'
             group by he.provider_id
          ), paid_by_provider as (
            select hp.provider_id, coalesce(sum(hp.amount_minor), 0) as paid_minor
              from honorarium_payments hp
             where hp.organization_id = ${ctx.organizationId}::uuid
             group by hp.provider_id
          )
          select count(*)::int as count
            from payable_by_provider p
            left join paid_by_provider d on d.provider_id = p.provider_id
           where p.payable_minor - coalesce(d.paid_minor, 0) > 0
        `)
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

    const [
      bookingRows,
      receptionRows,
      followUpRows,
      billingReadyRows,
      invoicePaymentsRows,
      honorariaRows,
      inventoryRows,
      sterilizationRows,
    ] = await Promise.all([
      bookingPromise,
      receptionPromise,
      followUpPromise,
      billingReadyPromise,
      invoicePaymentsPromise,
      honorariaPromise,
      inventoryPromise,
      sterilizationPromise,
    ]);
    const inventory = inventoryRows[0];
    const notifications: OperationalNotification[] = [];
    const add = (kind: OperationalNotificationKind, value: number, href: string, priority: OperationalNotification["priority"] = "attention") => {
      if (value > 0) notifications.push({ kind, count: value, href, priority });
    };

    add("bookingRequests", Number(bookingRows[0]?.count ?? 0), "/agenda/requests");
    add("receptionWaiting", Number(receptionRows[0]?.count ?? 0), "/reception");
    add("followUpsDue", Number(followUpRows[0]?.count ?? 0), "/follow-ups?tab=reminders");
    add("billingReady", Number(billingReadyRows[0]?.count ?? 0), "/invoices");
    add("invoicePaymentsDue", Number(invoicePaymentsRows[0]?.count ?? 0), "/invoices?state=open", "urgent");
    add("honorariaPayable", Number(honorariaRows[0]?.count ?? 0), "/honoraires");
    add("inventoryExpired", Number(inventory?.expired ?? 0), "/inventory", "urgent");
    add("sterilizationPending", Number(sterilizationRows[0]?.count ?? 0), "/sterilization");
    add("inventoryLow", Number(inventory?.low ?? 0), "/inventory");
    add("inventoryExpiring", Number(inventory?.expiring ?? 0), "/inventory");
    return notifications;
  });
}
