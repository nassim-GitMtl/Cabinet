import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader, ForbiddenState } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { getServicePickerData } from "@/features/catalog/server";
import { getPatient } from "@/features/patients/server";
import { patientDisplayName } from "@/features/patients/display";
import { TreatmentPlanForm } from "@/features/treatment-plans/components/treatment-plan-form";
import { can, requireClinicContext } from "@/server/auth/context";

export default async function NewTreatmentPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "patient.read") || !can(ctx, "treatment_plan.manage") || !can(ctx, "catalog.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const [patient, picker] = await Promise.all([getPatient(ctx, id), getServicePickerData(ctx)]);
  if (!patient) notFound();
  return <>
    <PageHeader title={t("treatmentPlans.new")} description={patientDisplayName(patient.patient)}
      back={<ButtonLink href={`/patients/${id}?tab=treatments`} variant="ghost">{t("common.back")}</ButtonLink>} />
    <TreatmentPlanForm patientId={id} picker={picker} currencySymbol={ctx.organization.settings.currencyDisplay ?? ctx.organization.defaultCurrency} />
  </>;
}
