import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { DocumentHeader } from "@/components/print/document-header";
import { getPrintBranding } from "@/features/clinic-identity/server";
import { PrintButton } from "@/components/print/print-button";
import { pageFormat } from "@/features/billing/page-format";
import { patientDisplayName } from "@/features/patients/display";
import { getPatient } from "@/features/patients/server";
import { getPlanPaymentSchedule } from "@/features/payment-plans/server";
import { getTreatmentPlan } from "@/features/treatment-plans/server";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("paymentPlans"))("estimateDocument") };
}

export default async function PrintEstimatePage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations("paymentPlans");
  if (!can(ctx, "treatment_plan.read") || !can(ctx, "patient.read")) return <ForbiddenState message={t("errors.forbidden")} />;
  const plan = await getTreatmentPlan(ctx, planId);
  if (!plan || !["proposed", "accepted", "completed"].includes(plan.status)) notFound();
  const [patient, fmt, schedule, branding] = await Promise.all([
    getPatient(ctx, plan.patientId), pageFormat(ctx),
    ["accepted", "completed"].includes(plan.status) ? getPlanPaymentSchedule(ctx, planId) : Promise.resolve(null),
    getPrintBranding(ctx),
  ]);
  if (!patient) notFound();
  return <article>
    <div className="no-print mb-4 flex justify-end"><PrintButton /></div>
    <DocumentHeader clinicName={ctx.organization.name} issuer={branding.issuer} logoVersion={branding.logoVersion} title={t("estimateDocument")}
      subtitle={<><p className="font-semibold">{plan.title}</p><p>{t("version", { version: plan.currentVersion })}</p></>} />
    <section className="avoid-break mb-5">
      <p className="text-[11px] uppercase text-neutral-600">{t("preparedFor")}</p>
      <p className="font-semibold"><bdi>{patientDisplayName(patient.patient)}</bdi> · {patient.patient.patientNumber}</p>
      {patient.patient.addressLine ? <p>{[patient.patient.addressLine, patient.patient.city, patient.patient.region].filter(Boolean).join(", ")}</p> : null}
      {patient.patient.phone ? <p dir="ltr" className="text-start">{formatPhone(patient.patient.phone, ctx.organization.countryCode)}</p> : null}
    </section>
    <table><thead><tr><th>{t("service")}</th><th>{t("details")}</th><th className="num">{t("quantity")}</th><th className="num">{t("amount")}</th></tr></thead>
      <tbody>{plan.items.map((item) => <tr key={item.id}><td><bdi>{fmt.label(item.serviceSnapshot.name)}</bdi><span className="block text-[10px] text-neutral-600"><bdi>{item.serviceSnapshot.code}</bdi></span></td>
        <td>{[item.toothNumber ? t("tooth", { tooth: item.toothNumber }) : null, item.surfaces.join(", ")].filter(Boolean).join(" · ")}</td><td className="num">{item.quantity}</td><td className="num">{fmt.money(item.quantity * item.unitPriceMinor, item.currency)}</td></tr>)}</tbody></table>
    <section className="avoid-break ms-auto mt-4 w-full max-w-xs"><p className="flex justify-between border-t pt-2 text-base font-bold"><span>{t("estimatedTotal")}</span><span className="num">{fmt.money(plan.totalMinor, plan.currency)}</span></p></section>
    {plan.notes ? <p className="mt-5 whitespace-pre-line">{plan.notes}</p> : null}
    {schedule ? <section className="avoid-break mt-6"><p className="mb-1 font-semibold">{t("scheduleTitle")}</p>
      <table><tbody>{schedule.installments.map((item) => <tr key={item.id}><td>{t("installment", { number: item.number })}</td><td>{formatDateOnly(item.dueDate)}</td><td className="num">{fmt.money(item.amountMinor, schedule.currency)}</td></tr>)}</tbody></table>
    </section> : null}
    <section className="avoid-break mt-10 flex justify-end"><div className="w-64 border-t pt-1 text-center text-[11px]">{t("signature")}</div></section>
    <footer className="mt-8 border-t pt-2 text-[10px] text-neutral-600"><p>{t("estimateNotice")}</p><p>{t("printedOn", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}</p></footer>
  </article>;
}
