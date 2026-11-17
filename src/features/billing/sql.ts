import "server-only";
import { sql } from "drizzle-orm";

/**
 * Derived ledger amounts. Subqueries run under the caller's RLS context.
 *
 * Written with explicit, aliased identifiers on purpose: Drizzle omits table
 * qualifiers in single-table selects, so `${invoices.id}` inside a correlated
 * subquery would bind to the subquery's own `id` column. The outer query must
 * select FROM the unaliased `invoices` / `payments` table.
 */
export const invoicePaidSql = sql<number>`coalesce((select sum(pa_i.amount_minor) from payment_allocations pa_i where pa_i.invoice_id = invoices.id), 0)::bigint`;
export const invoiceCreditedSql = sql<number>`coalesce((select sum(cn_i.amount_minor) from credit_notes cn_i where cn_i.invoice_id = invoices.id), 0)::bigint`;
export const invoiceBalanceSql = sql<number>`(invoices.total_minor - ${invoicePaidSql} - ${invoiceCreditedSql})`;

export const paymentAllocatedSql = sql<number>`coalesce((select sum(pa_p.amount_minor) from payment_allocations pa_p where pa_p.payment_id = payments.id), 0)::bigint`;
export const paymentRefundedSql = sql<number>`coalesce((select sum(r_p.amount_minor) from refunds r_p where r_p.payment_id = payments.id), 0)::bigint`;
export const paymentUnappliedSql = sql<number>`(case when payments.status = 'posted' then payments.amount_minor - ${paymentAllocatedSql} - ${paymentRefundedSql} else 0 end)`;

export type InvoicePaymentState = "draft" | "void" | "unpaid" | "partial" | "paid";

export function paymentState(inv: { status: string; totalMinor: number; paidMinor: number; creditedMinor: number }): InvoicePaymentState {
  if (inv.status === "draft") return "draft";
  if (inv.status === "void") return "void";
  const balance = inv.totalMinor - inv.paidMinor - inv.creditedMinor;
  if (balance <= 0) return "paid";
  return inv.paidMinor > 0 || inv.creditedMinor > 0 ? "partial" : "unpaid";
}
