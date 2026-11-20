import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { DocumentControls } from "@/components/print/document-controls";
import { DocumentHeader } from "@/components/print/document-header";
import { DocumentText } from "@/components/print/document-text";
import { getPrintBranding } from "@/features/clinic-identity/server";
import { pageFormat } from "@/features/billing/page-format";
import { patientDisplayName } from "@/features/patients/display";
import { getPatient } from "@/features/patients/server";
import { getPlanPaymentSchedule } from "@/features/payment-plans/server";
import { getTreatmentPlan } from "@/features/treatment-plans/server";
import { documentDirection, documentLocale, resolveDocumentLanguage } from "@/features/printing/document-language";
import { documentTranslation } from "@/features/printing/document-translations";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("paymentPlans"))("estimateDocument") };
}

export default async function PrintEstimatePage({ params, searchParams }: PageProps<"/print/estimates/[planId]">) {
  const { planId } = await params;
  const sp = await searchParams;
  const ctx = await requireClinicContext();
  const uiT = await getTranslations("paymentPlans");
  if (!can(ctx, "treatment_plan.read") || !can(ctx, "patient.read")) return <ForbiddenState message={uiT("errors.forbidden")} />;
  const plan = await getTreatmentPlan(ctx, planId);
  if (!plan || !["proposed", "accepted", "completed"].includes(plan.status)) notFound();
  const patient = await getPatient(ctx, plan.patientId);
  if (!patient) notFound();
  const language = resolveDocumentLanguage(sp.language, patient.patient.preferredLocale);
  const locale = documentLocale(language);
  const [fmt, schedule, branding] = await Promise.all([
    pageFormat(ctx, locale),
    ["accepted", "completed"].includes(plan.status) ? getPlanPaymentSchedule(ctx, planId) : Promise.resolve(null),
    getPrintBranding(ctx),
  ]);
  const text = (key: string, values?: Record<string, string | number>) => (
    <DocumentText language={language} fr={documentTranslation("fr", `paymentPlans.${key}`, values)} ar={documentTranslation("ar", `paymentPlans.${key}`, values)} />
  );
  return <article lang={locale} dir={documentDirection(language)} className={language === "ar" ? "document-arabic" : undefined}>
    <DocumentControls language={language} />
    <DocumentHeader clinicName={ctx.organization.name} issuer={branding.issuer} logoVersion={branding.logoVersion} title={text("estimateDocument")}
      subtitle={<><p className="font-semibold"><bdi>{plan.title}</bdi></p><p>{text("version", { version: plan.currentVersion })}</p></>} />
    <section className="avoid-break mb-5">
      <p className="text-[11px] uppercase text-neutral-600">{text("preparedFor")}</p>
      <p className="font-semibold"><bdi>{patientDisplayName(patient.patient)}</bdi> · {patient.patient.patientNumber}</p>
      {patient.patient.addressLine ? <p><bdi>{[patient.patient.addressLine, patient.patient.city, patient.patient.region].filter(Boolean).join(", ")}</bdi></p> : null}
      {patient.patient.phone ? <p dir="ltr" className="text-start">{formatPhone(patient.patient.phone, ctx.organization.countryCode)}</p> : null}
    </section>
    <table><thead><tr><th>{text("service")}</th><th>{text("details")}</th><th className="num">{text("quantity")}</th><th className="num">{text("amount")}</th></tr></thead>
      <tbody>{plan.items.map((item) => <tr key={item.id}><td><DocumentText language={language} fr={item.serviceSnapshot.name.fr} ar={item.serviceSnapshot.name.ar || item.serviceSnapshot.name.fr} /><span className="block text-[10px] text-neutral-600"><bdi>{item.serviceSnapshot.code}</bdi></span></td>
        <td>{item.toothNumber ? text("tooth", { tooth: item.toothNumber }) : null}{item.toothNumber && item.surfaces.length ? " · " : null}<bdi>{item.surfaces.join(", ")}</bdi></td><td className="num">{item.quantity}</td><td className="num">{fmt.money(item.quantity * item.unitPriceMinor, item.currency)}</td></tr>)}</tbody></table>
    <section className="avoid-break ms-auto mt-4 w-full max-w-xs"><p className="flex justify-between border-t pt-2 text-base font-bold"><span>{text("estimatedTotal")}</span><span className="num">{fmt.money(plan.totalMinor, plan.currency)}</span></p></section>
    {plan.notes ? <p className="mt-5 whitespace-pre-line"><bdi>{plan.notes}</bdi></p> : null}
    {schedule ? <section className="avoid-break mt-6"><p className="mb-1 font-semibold">{text("scheduleTitle")}</p>
      <table><tbody>{schedule.installments.map((item) => <tr key={item.id}><td>{text("installment", { number: item.number })}</td><td className="num">{formatDateOnly(item.dueDate)}</td><td className="num">{fmt.money(item.amountMinor, schedule.currency)}</td></tr>)}</tbody></table>
    </section> : null}
    <section className="avoid-break mt-10 flex justify-end"><div className="w-64 border-t pt-1 text-center text-[11px]">{text("signature")}</div></section>
    <footer className="mt-8 border-t pt-2 text-[10px] text-neutral-600"><p>{text("estimateNotice")}</p><p>{text("printedOn", { date: formatDateTime(new Date(), ctx.organization.timezone, fmt.intl) })}</p></footer>
  </article>;
}
