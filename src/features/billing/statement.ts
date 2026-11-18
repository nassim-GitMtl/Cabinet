import "server-only";
import { sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";

/**
 * Patient account statement for a period. Balance convention: positive = the
 * patient owes the clinic, negative = the clinic holds credit for the patient.
 *   + issued invoice (document date)      − credit note (document date)
 *   − payment received (receipt date)      + refund paid out (refund date)
 * Reversed payments and void invoices are excluded entirely (a void invoice
 * never had payments or credits, so it never affected the balance).
 */

export type StatementLine = {
  date: string;
  kind: "invoice" | "credit_note" | "payment" | "refund";
  reference: string;
  detail: string | null;
  debitMinor: number;
  creditMinor: number;
};

export async function getPatientStatement(ctx: ClinicContext, patientId: string, from: string, to: string) {
  requirePermission(ctx, "invoice.read");
  requirePermission(ctx, "payment.read");
  return tenantTx(ctx, async (tx) => {
    const events = await tx.execute<{ date: string; kind: StatementLine["kind"]; reference: string; detail: string | null; amount: string; currency: string }>(sql`
      select i.document_date::text as date, 'invoice' as kind, i.number as reference, null as detail, i.total_minor::text as amount, i.currency
        from invoices i
       where i.patient_id = ${patientId} and i.status = 'issued'
      union all
      select cn.document_date::text, 'credit_note', cn.number, cn.reason, cn.amount_minor::text, cn.currency
        from credit_notes cn join invoices i on i.id = cn.invoice_id
       where i.patient_id = ${patientId}
      union all
      select p.received_on::text, 'payment', p.receipt_number, p.method::text, p.amount_minor::text, p.currency
        from payments p
       where p.patient_id = ${patientId} and p.status = 'posted'
      union all
      select r.refunded_on::text, 'refund', p.receipt_number, r.reason, r.amount_minor::text, p.currency
        from refunds r join payments p on p.id = r.payment_id
       where p.patient_id = ${patientId}
      order by 1, 2`);

    const currency = ctx.organization.defaultCurrency;
    const signed = (kind: StatementLine["kind"], amount: number) => (kind === "invoice" || kind === "refund" ? amount : -amount);
    let opening = 0;
    const lines: (StatementLine & { balanceMinor: number })[] = [];
    let running = 0;
    for (const e of events) {
      if (e.currency !== currency) continue;
      const amount = Number(e.amount);
      if (e.date < from) {
        opening += signed(e.kind, amount);
        continue;
      }
      if (e.date > to) continue;
      if (lines.length === 0) running = opening;
      running += signed(e.kind, amount);
      lines.push({
        date: e.date,
        kind: e.kind,
        reference: e.reference,
        detail: e.detail,
        debitMinor: signed(e.kind, amount) > 0 ? amount : 0,
        creditMinor: signed(e.kind, amount) < 0 ? amount : 0,
        balanceMinor: running,
      });
    }
    const closing = lines.length ? running : opening;
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: "patient.statement.viewed",
      entityType: "patient",
      entityId: patientId,
      patientId,
      metadata: { from, to },
    });
    return {
      from,
      to,
      currency,
      openingMinor: opening,
      closingMinor: closing,
      totalDebitMinor: lines.reduce((s, l) => s + l.debitMinor, 0),
      totalCreditMinor: lines.reduce((s, l) => s + l.creditMinor, 0),
      lines,
    };
  });
}
