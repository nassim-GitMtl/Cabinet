import "server-only";

import { sql } from "drizzle-orm";
import { withDbContext } from "@/server/db/tenant";
import type { PatientPortalContext } from "@/server/portal/session";

export type PortalClinicLink = {
  organizationId: string;
  patientId: string;
  organizationName: string;
  timezone: string;
  currencyDisplay: string;
};

export type PortalAppointment = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  schedulingStatus: "requested" | "booked" | "cancelled" | "no_show";
  confirmationStatus: "pending" | "confirmed" | "declined" | "reschedule_requested";
  visitStatus: "not_arrived" | "arrived" | "waiting" | "in_treatment" | "completed";
  providerName: string;
  providerTitle: string | null;
  typeName: Record<string, string> | null;
};

export type PortalEstimate = {
  id: string;
  status: "accepted" | "completed";
  title: string;
  currency: string;
  totalMinor: number;
  acceptedAt: Date | null;
};

export type PortalInvoice = {
  id: string;
  number: string;
  status: "issued" | "void";
  documentDate: string;
  dueDate: string | null;
  currency: string;
  totalMinor: number;
  balanceMinor: number;
};

export type PortalPayment = {
  id: string;
  receiptNumber: string;
  receivedOn: string;
  method: "cash" | "card" | "bank_transfer" | "cheque" | "other";
  status: "posted" | "reversed";
  currency: string;
  amountMinor: number;
};

export type PortalClinicData = PortalClinicLink & {
  appointments: PortalAppointment[];
  estimates: PortalEstimate[];
  invoices: PortalInvoice[];
  payments: PortalPayment[];
};

export async function listPatientPortalData(ctx: PatientPortalContext): Promise<PortalClinicData[]> {
  const links = await withDbContext(
    { actorType: "patient", networkPatientId: ctx.networkPatientId },
    async (tx) => tx.execute<{
      organization_id: string; patient_id: string; organization_name: string;
      timezone: string; currency_display: string;
    }>(sql`select * from app_private.patient_portal_links()`),
  );

  return Promise.all(links.map(async (link) => withDbContext({
    organizationId: link.organization_id,
    actorType: "patient",
    networkPatientId: ctx.networkPatientId,
  }, async (tx) => {
    const [appointments, estimates, invoices, payments] = await Promise.all([
      tx.execute<PortalAppointment>(sql`
        select a.id, a.starts_at as "startsAt", a.ends_at as "endsAt",
               a.scheduling_status as "schedulingStatus",
               a.confirmation_status as "confirmationStatus",
               a.visit_status as "visitStatus", m.display_name as "providerName",
               m.title as "providerTitle", t.name as "typeName"
          from appointments a
          join memberships m on m.id = a.provider_id
          left join appointment_types t on t.id = a.appointment_type_id
         where a.organization_id = ${link.organization_id}
           and a.patient_id = ${link.patient_id}
         order by a.starts_at desc limit 20`),
      tx.execute<PortalEstimate>(sql`
        select p.id, p.status, v.title, v.currency, v.total_minor as "totalMinor",
               d.decided_at as "acceptedAt"
          from treatment_plans p
          join treatment_plan_versions v
            on v.plan_id = p.id and v.version_number = p.current_version
          left join treatment_plan_decisions d
            on d.version_id = v.id and d.decision = 'accepted'
         where p.organization_id = ${link.organization_id}
           and p.patient_id = ${link.patient_id}
           and p.status in ('accepted', 'completed')
         order by coalesce(d.decided_at, p.updated_at) desc limit 20`),
      tx.execute<PortalInvoice>(sql`
        select i.id, i.number, i.status, i.document_date as "documentDate",
               i.due_date as "dueDate", i.currency, i.total_minor as "totalMinor",
               greatest(0, i.total_minor
                 - coalesce((select sum(c.amount_minor) from credit_notes c where c.invoice_id = i.id), 0)
                 - coalesce((select sum(a.amount_minor) from payment_allocations a where a.invoice_id = i.id), 0)
               ) as "balanceMinor"
          from invoices i
         where i.organization_id = ${link.organization_id}
           and i.patient_id = ${link.patient_id} and i.status in ('issued', 'void')
         order by i.document_date desc, i.number desc limit 30`),
      tx.execute<PortalPayment>(sql`
        select p.id, p.receipt_number as "receiptNumber", p.received_on as "receivedOn",
               p.method, p.status, p.currency, p.amount_minor as "amountMinor"
          from payments p
         where p.organization_id = ${link.organization_id}
           and p.patient_id = ${link.patient_id}
         order by p.received_on desc, p.created_at desc limit 30`),
    ]);
    return {
      organizationId: link.organization_id,
      patientId: link.patient_id,
      organizationName: link.organization_name,
      timezone: link.timezone,
      currencyDisplay: link.currency_display,
      appointments,
      estimates: estimates.map((estimate) => ({ ...estimate, totalMinor: Number(estimate.totalMinor) })),
      invoices: invoices.map((invoice) => ({
        ...invoice, totalMinor: Number(invoice.totalMinor), balanceMinor: Number(invoice.balanceMinor),
      })),
      payments: payments.map((payment) => ({ ...payment, amountMinor: Number(payment.amountMinor) })),
    };
  })));
}
