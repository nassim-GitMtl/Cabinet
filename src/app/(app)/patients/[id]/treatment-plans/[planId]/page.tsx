import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CheckCircle2Icon, ExternalLinkIcon, PencilIcon } from "lucide-react";
import { PageHeader, ForbiddenState } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { getPatient } from "@/features/patients/server";
import { patientDisplayName } from "@/features/patients/display";
import { getProcedureEntrySupport } from "@/features/procedures/server";
import { pageFormat } from "@/features/billing/page-format";
import { ConvertItemForm, DecisionForms, ProposePlanForm } from "@/features/treatment-plans/components/treatment-plan-actions";
import { getTreatmentPlan } from "@/features/treatment-plans/server";
import { formatDateTime, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export default async function TreatmentPlanPage({ params }: { params: Promise<{ id: string; planId: string }> }) {
  const { id, planId } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "treatment_plan.read") || !can(ctx, "patient.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const [plan, patient, fmt] = await Promise.all([getTreatmentPlan(ctx, planId), getPatient(ctx, id), pageFormat(ctx)]);
  if (!plan || !patient || plan.patientId !== id) notFound();
  const canConvert = can(ctx, "treatment_plan.convert") && can(ctx, "clinical.write") && plan.status === "accepted";
  const support = canConvert ? await getProcedureEntrySupport(ctx) : null;
  const providers = support?.providers.map((row) => ({ id: row.id, name: [row.title, row.displayName].filter(Boolean).join(" ") })) ?? [];
  const branches = support?.branches ?? [];
  const anatomy = (item: (typeof plan.items)[number]) => [
    item.toothNumber ? t("treatmentPlans.tooth", { tooth: item.toothNumber }) : null,
    item.surfaces.length ? item.surfaces.map((x) => t(`procedures.surfaces.${x}`)).join(", ") : null,
    item.arch ? t(`procedures.arches.${item.arch}`) : null,
    item.quadrant ? t(`procedures.quadrants.${item.quadrant}`) : null,
  ].filter(Boolean).join(" · ");

  return <>
    <PageHeader title={plan.title} description={`${patientDisplayName(patient.patient)} · ${t("treatmentPlans.version", { version: plan.currentVersion })}`}
      back={<ButtonLink href={`/patients/${id}?tab=treatments`} variant="ghost">{t("common.back")}</ButtonLink>}
      actions={<div className="flex flex-wrap gap-2"><Badge variant={plan.status === "accepted" ? "default" : "secondary"}>{t(`treatmentPlans.status.${plan.status}`)}</Badge>
        {can(ctx, "treatment_plan.manage") && !["completed", "cancelled"].includes(plan.status) ? <ButtonLink href={`/patients/${id}/treatment-plans/${planId}/revise`} variant="outline"><PencilIcon aria-hidden />{t("treatmentPlans.revise")}</ButtonLink> : null}</div>} />

    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <section className="overflow-hidden rounded-2xl border bg-card">
          <div className="border-b p-4 sm:p-5"><h2 className="font-semibold">{t("treatmentPlans.estimate")}</h2>{plan.notes ? <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground" dir="auto">{plan.notes}</p> : null}</div>
          <ol className="divide-y">
            {plan.items.map((item) => <li key={item.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-medium"><bdi>{fmt.label(item.serviceSnapshot.name)}</bdi></p><p className="text-xs text-muted-foreground"><bdi>{item.serviceSnapshot.code}</bdi>{anatomy(item) ? ` · ${anatomy(item)}` : ""}</p></div>
                <div className="text-end"><p className="font-semibold tabular">{fmt.money(item.unitPriceMinor * item.quantity, item.currency)}</p>{item.quantity > 1 ? <p className="text-xs text-muted-foreground">{item.quantity} × {fmt.money(item.unitPriceMinor, item.currency)}</p> : null}</div>
              </div>
              {item.performedProcedureId ? <Link href={`/patients/${id}?tab=clinical`} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-success hover:underline"><CheckCircle2Icon className="size-4" aria-hidden />{t("treatmentPlans.converted")}<ExternalLinkIcon className="size-3" aria-hidden /></Link> : null}
              {canConvert && !item.performedProcedureId && support ? <ConvertItemForm planId={planId} itemId={item.id} expectedVersion={plan.version}
                providers={providers} branches={branches} defaultProviderId={patient.provider?.id ?? providers[0]?.id ?? ""}
                defaultBranchId={branches[0]?.id ?? ""} defaultDate={todayInZone(ctx.organization.timezone)} /> : null}
            </li>)}
          </ol>
          <div className="flex items-center justify-between bg-muted/40 p-4 sm:px-5"><strong>{t("treatmentPlans.estimatedTotal")}</strong><strong className="text-lg tabular">{fmt.money(plan.totalMinor, plan.currency)}</strong></div>
        </section>

        {plan.status === "draft" && can(ctx, "treatment_plan.manage") ? <section className="rounded-2xl border bg-card p-4"><h2 className="mb-1 font-semibold">{t("treatmentPlans.readyToPropose")}</h2><p className="mb-3 text-sm text-muted-foreground">{t("treatmentPlans.proposeHint")}</p><ProposePlanForm planId={planId} expectedVersion={plan.version} /></section> : null}
        {plan.status === "proposed" && can(ctx, "treatment_plan.accept") ? <section className="rounded-2xl border bg-card p-4"><h2 className="mb-1 font-semibold">{t("treatmentPlans.recordDecision")}</h2><p className="mb-3 text-sm text-muted-foreground">{t("treatmentPlans.decisionHint")}</p><DecisionForms planId={planId} expectedVersion={plan.version} /></section> : null}
      </div>

      <aside className="space-y-4">
        {plan.decision ? <section className="rounded-2xl border bg-card p-4"><h2 className="font-semibold">{t("treatmentPlans.patientDecision")}</h2><p className="mt-2"><Badge>{t(`treatmentPlans.status.${plan.decision.decision}`)}</Badge></p><dl className="mt-3 space-y-2 text-sm"><div><dt className="text-muted-foreground">{t("treatmentPlans.decisionMethod")}</dt><dd>{t(`treatmentPlans.methods.${plan.decision.method}`)}</dd></div><div><dt className="text-muted-foreground">{t("treatmentPlans.decisionDate")}</dt><dd>{formatDateTime(plan.decision.decidedAt, ctx.organization.timezone)}</dd></div></dl>{plan.decision.note ? <p className="mt-3 whitespace-pre-line border-t pt-3 text-sm" dir="auto">{plan.decision.note}</p> : null}</section> : null}
        <section className="rounded-2xl border bg-card p-4"><h2 className="font-semibold">{t("treatmentPlans.history")}</h2><ol className="mt-3 space-y-3">{plan.history.map((entry) => <li key={entry.versionNumber} className="border-s ps-3 text-sm"><div className="flex items-center justify-between gap-2"><span>{t("treatmentPlans.version", { version: entry.versionNumber })}</span><span className="tabular">{fmt.money(entry.totalMinor, entry.currency)}</span></div><p className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt, ctx.organization.timezone)}{entry.decision ? ` · ${t(`treatmentPlans.status.${entry.decision}`)}` : ""}</p></li>)}</ol></section>
      </aside>
    </div>
  </>;
}
