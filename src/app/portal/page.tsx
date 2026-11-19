import { CalendarDaysIcon, FileCheckIcon, HeartPulseIcon, ReceiptTextIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConsentDecisionButtons, LogoutButton, RevokeGrantForm } from "@/features/consent/components/portal-forms";
import { listPatientConsents } from "@/features/consent/portal";
import { listPatientPortalData } from "@/features/consent/portal-data";
import { listPortalHealthQuestionnaires } from "@/features/health/patient";
import { ButtonLink } from "@/components/button-link";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requirePatientSession } from "@/server/portal/session";

const localeTag = (locale: string) => locale === "ar" ? "ar-DZ" : locale === "en" ? "en-CA" : "fr-DZ";
const localized = (value: Record<string, string> | null, locale: string, fallback: string) => value?.[locale] ?? value?.fr ?? value?.en ?? fallback;

export default async function PortalPage() {
  const ctx = await requirePatientSession();
  const [data, clinics, health, t] = await Promise.all([listPatientConsents(ctx), listPatientPortalData(ctx), listPortalHealthQuestionnaires(ctx), getTranslations("portal")]);
  const pending = data.requests.filter((r) => r.status === "awaiting_patient" && r.expiresAt > new Date());
  const locale = localeTag(ctx.locale);

  return <div className="space-y-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{t("dashboardTitle")}</h1><p className="text-sm text-muted-foreground"><bdi>{ctx.email}</bdi> · {t("dashboardSubtitle")}</p></div><LogoutButton /></header>

    {clinics.map((clinic) => {
      return <section key={`${clinic.organizationId}:${clinic.patientId}`} className="space-y-4">
        <div><h2 className="text-xl font-semibold"><bdi>{clinic.organizationName}</bdi></h2><p className="text-sm text-muted-foreground">{t("clinicRecord")}</p></div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDaysIcon className="size-4 text-primary" />{t("appointments")}</CardTitle><CardDescription>{t("appointmentsDescription")}</CardDescription></CardHeader><CardContent className="space-y-3">
            {clinic.appointments.slice(0, 8).map((appointment) => <div key={appointment.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-2"><span className="font-medium">{formatDateTime(appointment.startsAt, clinic.timezone, locale)}</span><Badge variant="secondary">{t(`appointmentStatus.${appointment.schedulingStatus}`)}</Badge></div>
              <p className="mt-1 text-muted-foreground"><bdi>{localized(appointment.typeName, ctx.locale, t("appointment"))}</bdi></p>
              <p className="text-xs text-muted-foreground"><bdi>{[appointment.providerTitle, appointment.providerName].filter(Boolean).join(" ")}</bdi> · {t(`confirmationStatus.${appointment.confirmationStatus}`)}</p>
            </div>)}
            {clinic.appointments.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAppointments")}</p> : null}
          </CardContent></Card>

          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileCheckIcon className="size-4 text-primary" />{t("acceptedEstimates")}</CardTitle><CardDescription>{t("acceptedEstimatesDescription")}</CardDescription></CardHeader><CardContent className="space-y-3">
            {clinic.estimates.map((estimate) => <div key={estimate.id} className="rounded-lg border p-3 text-sm"><div className="flex items-start justify-between gap-2"><bdi className="font-medium">{estimate.title}</bdi><Badge variant="secondary">{t(`estimateStatus.${estimate.status}`)}</Badge></div><ul className="my-2 divide-y border-y">{estimate.items.map((item) => <li key={item.id} className="flex justify-between gap-3 py-1.5 text-xs"><bdi>{localized(item.name, ctx.locale, item.code)}{item.quantity > 1 ? ` × ${item.quantity}` : ""}</bdi><span className="shrink-0">{formatMoney(item.amountMinor, estimate.currency, locale, clinic.currencyDisplay)}</span></li>)}</ul><p className="mt-2 text-lg font-semibold" dir="auto">{formatMoney(Number(estimate.totalMinor), estimate.currency, locale, clinic.currencyDisplay)}</p>{estimate.acceptedAt ? <p className="text-xs text-muted-foreground">{t("acceptedOn", { date: formatDateTime(estimate.acceptedAt, clinic.timezone, locale) })}</p> : null}{estimate.installments.length ? <div className="mt-3 border-t pt-2"><p className="mb-1 text-xs font-semibold">{t("paymentSchedule")}</p>{estimate.installments.map((item) => <p key={item.id} className="flex justify-between gap-2 text-xs"><span>{formatDateOnly(item.dueDate)}</span><span>{formatMoney(item.paidMinor >= item.amountMinor ? item.amountMinor : item.amountMinor - item.paidMinor, estimate.currency, locale, clinic.currencyDisplay)} {item.paidMinor >= item.amountMinor ? t("installmentPaid") : t("installmentDue")}</span></p>)}</div> : null}</div>)}
            {clinic.estimates.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAcceptedEstimates")}</p> : null}
          </CardContent></Card>

          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ReceiptTextIcon className="size-4 text-primary" />{t("billingHistory")}</CardTitle><CardDescription>{t("billingDescription")}</CardDescription></CardHeader><CardContent className="space-y-4">
            <div className="space-y-2">{clinic.invoices.map((invoice) => <div key={invoice.id} className="rounded-lg border p-3 text-sm"><div className="flex items-start justify-between gap-2"><span className="font-medium"><bdi>{invoice.number}</bdi> · {formatDateOnly(invoice.documentDate)}</span><Badge variant={invoice.status === "void" ? "destructive" : "secondary"}>{invoice.status === "void" ? t("void") : Number(invoice.balanceMinor) === 0 ? t("paid") : t("due")}</Badge></div><p className="mt-1" dir="auto">{formatMoney(Number(invoice.totalMinor), invoice.currency, locale, clinic.currencyDisplay)}</p>{invoice.status !== "void" && Number(invoice.balanceMinor) > 0 ? <p className="text-xs text-muted-foreground">{t("balance", { amount: formatMoney(Number(invoice.balanceMinor), invoice.currency, locale, clinic.currencyDisplay) })}</p> : null}</div>)}{clinic.invoices.length === 0 ? <p className="text-sm text-muted-foreground">{t("noInvoices")}</p> : null}</div>
            {clinic.payments.length > 0 ? <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("payments")}</h3><div className="space-y-2">{clinic.payments.map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 text-sm"><span><bdi>{payment.receiptNumber}</bdi> · {formatDateOnly(payment.receivedOn)}</span><span className={payment.status === "reversed" ? "text-muted-foreground line-through" : "font-medium"} dir="auto">{formatMoney(Number(payment.amountMinor), payment.currency, locale, clinic.currencyDisplay)}</span></div>)}</div></div> : null}
            <p className="text-xs text-muted-foreground">{t("billingContactClinic")}</p>
          </CardContent></Card>
          {health.find((item) => item.organizationId === clinic.organizationId) ? <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><HeartPulseIcon className="size-4 text-primary" />{t("healthQuestionnaire")}</CardTitle><CardDescription>{t("healthQuestionnaireDescription")}</CardDescription></CardHeader><CardContent><p className="mb-3 text-sm text-muted-foreground">{health.find((item) => item.organizationId === clinic.organizationId)?.latestAt ? t("healthLastUpdated", { date: formatDateTime(health.find((item) => item.organizationId === clinic.organizationId)!.latestAt!, clinic.timezone, locale) }) : t("healthNotCompleted")}</p><ButtonLink href={`/portal/health/${clinic.organizationId}`}>{t("healthComplete")}</ButtonLink></CardContent></Card> : null}
        </div>
      </section>;
    })}
    {clinics.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t("noClinicRecords")}</CardContent></Card> : null}

    <section><h2 className="mb-3 text-lg font-semibold">{t("pendingRequests")}</h2><div className="grid gap-4">
      {pending.map((request) => <Card key={request.id} className="border-primary/30"><CardHeader><div className="flex justify-between gap-3"><CardTitle className="text-base"><bdi>{data.organizations[request.requestingOrganizationId] ?? t("clinic")}</bdi></CardTitle><Badge>{t("decisionRequired")}</Badge></div><CardDescription><bdi>{request.purpose}</bdi></CardDescription></CardHeader><CardContent><p className="text-sm font-medium">{t("scope")}</p><p className="mt-1 text-sm text-muted-foreground">{request.requestedScope.categories.map((c) => t(`category.${c}`)).join(" · ")}</p><p className="mt-2 text-xs text-muted-foreground">{request.requestedScope.includeFutureUpdates ? t("includesFuture") : t("noFuture")}</p><ConsentDecisionButtons requestId={request.id} /></CardContent></Card>)}
      {pending.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t("noPending")}</CardContent></Card> : null}
    </div></section>
    <section><h2 className="mb-3 text-lg font-semibold">{t("approvedGrants")}</h2><div className="grid gap-4 sm:grid-cols-2">
      {data.grants.map((grant) => <Card key={grant.id}><CardHeader><div className="flex justify-between gap-2"><CardTitle className="text-base"><bdi>{data.organizations[grant.receivingOrganizationId] ?? t("clinic")}</bdi></CardTitle><Badge variant="secondary">{t(`status.${grant.status}`)}</Badge></div><CardDescription><bdi>{grant.purpose}</bdi></CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{grant.categories.map((c) => t(`category.${c}`)).join(" · ")}</p>{grant.status === "active" ? <RevokeGrantForm grantId={grant.id} /> : null}</CardContent></Card>)}
      {data.grants.length === 0 ? <p className="text-sm text-muted-foreground">{t("noGrants")}</p> : null}
    </div></section>
  </div>;
}
