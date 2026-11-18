import "server-only";
import { sql } from "drizzle-orm";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";
import { addDays, zonedToUtc } from "@/lib/dates";

/**
 * Receivables aging AS OF a date (§18 "Outstanding receivables"): issued
 * charges dated on/before the date, less credit notes dated on/before it, less
 * payment allocations recorded before the end of that day. Invoices voided
 * after the date still count (they were outstanding then). Age is measured
 * from the due date, or the invoice date when there is no due date.
 */

export const AGING_BUCKETS = ["current", "d31_60", "d61_90", "over90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function bucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 30) return "current";
  if (ageDays <= 60) return "d31_60";
  if (ageDays <= 90) return "d61_90";
  return "over90";
}

type Row = {
  invoice_id: string;
  number: string;
  document_date: string;
  due_date: string | null;
  currency: string;
  total_minor: string;
  credited_minor: string;
  paid_minor: string;
  patient_id: string;
  patient_number: string;
  first_name: string;
  last_name: string;
  phone: string | null;
};

export async function getReceivablesAging(ctx: ClinicContext, asOf: string) {
  requirePermission(ctx, "report.financial");
  const endOfDay = zonedToUtc(addDays(asOf, 1), "00:00", ctx.organization.timezone).toISOString();
  const rows = await tenantTx(ctx, (tx) =>
    tx.execute<Row>(sql`
      select i.id as invoice_id, i.number, i.document_date::text, i.due_date::text, i.currency,
             i.total_minor::text,
             coalesce((select sum(cn.amount_minor) from credit_notes cn
                        where cn.invoice_id = i.id and cn.document_date <= ${asOf}::date), 0)::text as credited_minor,
             coalesce((select sum(pa.amount_minor) from payment_allocations pa
                        where pa.invoice_id = i.id and pa.created_at < ${endOfDay}::timestamptz), 0)::text as paid_minor,
             p.id as patient_id, p.patient_number, p.first_name, p.last_name, p.phone
        from invoices i
        join patients p on p.id = i.patient_id
       where i.number is not null
         and i.document_date <= ${asOf}::date
         and (i.status = 'issued' or (i.status = 'void' and i.voided_at >= ${endOfDay}::timestamptz))
       order by p.last_name, p.first_name, i.document_date`),
  );

  const currency = ctx.organization.defaultCurrency;
  const totals: Record<AgingBucket, number> = { current: 0, d31_60: 0, d61_90: 0, over90: 0 };
  const patients = new Map<string, { patientId: string; patientNumber: string; name: string; phone: string | null; buckets: Record<AgingBucket, number>; total: number; invoices: { id: string; number: string; date: string; ageDays: number; balanceMinor: number }[] }>();
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  for (const r of rows) {
    if (r.currency !== currency) continue; // other currencies are never summed
    const balance = Number(r.total_minor) - Number(r.credited_minor) - Number(r.paid_minor);
    if (balance <= 0) continue;
    const ref = r.due_date ?? r.document_date;
    const ageDays = Math.max(0, Math.round((asOfMs - Date.parse(`${ref}T00:00:00Z`)) / 86_400_000));
    const bucket = bucketFor(ageDays);
    const p =
      patients.get(r.patient_id) ??
      patients.set(r.patient_id, { patientId: r.patient_id, patientNumber: r.patient_number, name: `${r.last_name.toUpperCase()} ${r.first_name}`, phone: r.phone, buckets: { current: 0, d31_60: 0, d61_90: 0, over90: 0 }, total: 0, invoices: [] }).get(r.patient_id)!;
    p.buckets[bucket] += balance;
    p.total += balance;
    p.invoices.push({ id: r.invoice_id, number: r.number, date: r.document_date, ageDays, balanceMinor: balance });
    totals[bucket] += balance;
  }
  const list = [...patients.values()].sort((a, b) => b.total - a.total);
  return { asOf, currency, patients: list, totals, grandTotal: Object.values(totals).reduce((s, v) => s + v, 0) };
}

export type AgingReport = Awaited<ReturnType<typeof getReceivablesAging>>;
