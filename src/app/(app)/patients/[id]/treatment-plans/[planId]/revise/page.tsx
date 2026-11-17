import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader, ForbiddenState } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { getServicePickerData } from "@/features/catalog/server";
import { TreatmentPlanForm, type PlanItemDraft } from "@/features/treatment-plans/components/treatment-plan-form";
import { getTreatmentPlan } from "@/features/treatment-plans/server";
import { can, requireClinicContext } from "@/server/auth/context";

export default async function ReviseTreatmentPlanPage({ params }: { params: Promise<{ id: string; planId: string }> }) {
  const { id, planId } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "treatment_plan.manage") || !can(ctx, "catalog.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const [plan, picker] = await Promise.all([getTreatmentPlan(ctx, planId), getServicePickerData(ctx)]);
  if (!plan || plan.patientId !== id || plan.status === "completed" || plan.status === "cancelled") notFound();
  const initialItems: PlanItemDraft[] = plan.items.map((item) => ({
    key: item.id, serviceId: item.serviceId, quantity: item.quantity, toothNumber: item.toothNumber,
    surfaces: item.surfaces, arch: item.arch, quadrant: item.quadrant,
  }));
  return <>
    <PageHeader title={t("treatmentPlans.revise")} description={t("treatmentPlans.revisionCreatesVersion")}
      back={<ButtonLink href={`/patients/${id}/treatment-plans/${planId}`} variant="ghost">{t("common.back")}</ButtonLink>} />
    <TreatmentPlanForm patientId={id} picker={picker} currencySymbol={ctx.organization.settings.currencyDisplay ?? ctx.organization.defaultCurrency}
      initialTitle={plan.title} initialNotes={plan.notes} initialItems={initialItems} planId={planId} expectedVersion={plan.version} />
  </>;
}
