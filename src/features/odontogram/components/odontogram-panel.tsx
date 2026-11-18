"use client";

import { useActionState, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2Icon, CircleAlertIcon, LinkIcon, PlusIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { initialActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import type { ServiceSnapshot } from "@/server/db/schema";
import { createOdontogramFindingAction, changeOdontogramFindingStatusAction } from "../actions";
import { FINDING_KINDS } from "../schemas";
import { SURFACES } from "@/features/procedures/schemas";

type Finding = {
  id: string; toothNumber: string; surfaces: string[]; kind: typeof FINDING_KINDS[number];
  status: "active" | "resolved" | "entered_in_error"; note: string | null; observedOn: string;
  providerName: string; providerTitle: string | null; treatmentPlanItemId: string | null;
  performedProcedureId: string | null;
};
type LinkOption = { id: string; toothNumber: string | null; serviceSnapshot: ServiceSnapshot };
type PlanOption = LinkOption & { planTitle: string; planStatus: string };
type ProcedureOption = LinkOption & { serviceDate: string };

const UPPER_RIGHT = ["18", "17", "16", "15", "14", "13", "12", "11"];
const UPPER_LEFT = ["21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER_RIGHT = ["48", "47", "46", "45", "44", "43", "42", "41"];
const LOWER_LEFT = ["31", "32", "33", "34", "35", "36", "37", "38"];

const KIND_TONE: Record<typeof FINDING_KINDS[number], string> = {
  caries: "border-destructive/60 bg-destructive/10 text-destructive",
  existing_filling: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  crown: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  bridge: "border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  missing: "border-muted-foreground/40 bg-muted text-muted-foreground line-through",
  implant: "border-teal-500/60 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  root_canal: "border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  fracture: "border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  mobility: "border-yellow-500/60 bg-yellow-500/10 text-yellow-800 dark:text-yellow-200",
  other: "border-slate-500/50 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

function FindingStatusActions({ findingId }: { findingId: string }) {
  const t = useTranslations("odontogram");
  const [resolved, resolveAction] = useActionState(changeOdontogramFindingStatusAction.bind(null, findingId), initialActionState);
  const [error, errorAction] = useActionState(changeOdontogramFindingStatusAction.bind(null, findingId), initialActionState);
  return <details className="mt-3 border-t pt-3">
    <summary className="cursor-pointer text-xs font-medium text-primary">{t("closeFinding")}</summary>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <form action={resolveAction} className="space-y-2"><input type="hidden" name="status" value="resolved" /><FormError error={resolved.error} /><TextField label={t("resolutionNote")} name="reason" required error={resolved.fieldErrors?.reason} /><SubmitButton size="sm" variant="outline"><CheckCircle2Icon />{t("resolve")}</SubmitButton></form>
      <form action={errorAction} className="space-y-2"><input type="hidden" name="status" value="entered_in_error" /><FormError error={error.error} /><TextField label={t("errorReason")} name="reason" required error={error.fieldErrors?.reason} /><SubmitButton size="sm" variant="destructive"><CircleAlertIcon />{t("enterInError")}</SubmitButton></form>
    </div>
  </details>;
}

export function OdontogramPanel({ patientId, findings, providers, planItems, procedures, canWrite, today }: {
  patientId: string; findings: Finding[]; providers: { id: string; displayName: string; title: string | null }[];
  planItems: PlanOption[]; procedures: ProcedureOption[]; canWrite: boolean; today: string;
}) {
  const t = useTranslations("odontogram");
  const procedureT = useTranslations("procedures");
  const locale = useLocale();
  const [selectedTooth, setSelectedTooth] = useState(findings.find((f) => f.status === "active")?.toothNumber ?? "11");
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [state, action] = useActionState(createOdontogramFindingAction.bind(null, patientId), initialActionState);
  const activeByTooth = useMemo(() => {
    const map = new Map<string, Finding[]>();
    findings.filter((finding) => finding.status === "active").forEach((finding) => map.set(finding.toothNumber, [...(map.get(finding.toothNumber) ?? []), finding]));
    return map;
  }, [findings]);
  const selectedFindings = findings.filter((finding) => finding.toothNumber === selectedTooth);
  const serviceName = (snapshot: ServiceSnapshot) => snapshot.name[locale as "fr"] ?? snapshot.name.fr;
  const renderQuadrant = (teeth: string[]) => <div className="grid grid-cols-8 gap-1">{teeth.map((tooth) => {
    const active = activeByTooth.get(tooth) ?? [];
    const first = active[0];
    return <Button key={tooth} type="button" variant="outline" className={cn("relative h-12 min-w-0 px-0 tabular", selectedTooth === tooth && "ring-2 ring-primary", first && KIND_TONE[first.kind])} onClick={() => setSelectedTooth(tooth)} aria-label={t("toothLabel", { tooth, count: active.length })}>
      {tooth}{active.length > 1 ? <span className="absolute -end-1 -top-1 grid size-4 place-items-center rounded-full bg-foreground text-[9px] text-background">{active.length}</span> : null}
    </Button>;
  })}</div>;

  return <section className="space-y-4" aria-labelledby="odontogram-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="odontogram-heading" className="text-lg font-semibold">{t("title")}</h2><p className="text-sm text-muted-foreground">{t("subtitle")}</p></div>{canWrite ? <Badge variant="outline">{t("immutableHint")}</Badge> : null}</div>
    <div className="rounded-2xl border bg-card p-3 sm:p-5" dir="ltr">
      <div className="grid gap-1 sm:grid-cols-2"><div>{renderQuadrant(UPPER_RIGHT)}</div><div>{renderQuadrant(UPPER_LEFT)}</div><div className="mt-2 border-t pt-2">{renderQuadrant(LOWER_RIGHT)}</div><div className="mt-2 border-t pt-2">{renderQuadrant(LOWER_LEFT)}</div></div>
      <p className="mt-3 text-center text-xs text-muted-foreground" dir="auto">{t("chartHint")}</p>
    </div>

    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-3">
        <h3 className="font-semibold">{t("selectedTooth", { tooth: selectedTooth })}</h3>
        {selectedFindings.length ? selectedFindings.map((finding) => <article key={finding.id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><Badge className={KIND_TONE[finding.kind]} variant="outline">{t(`kinds.${finding.kind}`)}</Badge><Badge variant="secondary">{t(`status.${finding.status}`)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{finding.observedOn} · <bdi>{[finding.providerTitle, finding.providerName].filter(Boolean).join(" ")}</bdi></p></div>{finding.surfaces.length ? <span className="text-xs text-muted-foreground">{finding.surfaces.map((surface) => procedureT(`surfaces.${surface as "mesial"}`)).join(" · ")}</span> : null}</div>
          {finding.note ? <p className="mt-3 whitespace-pre-line text-sm" dir="auto"><bdi>{finding.note}</bdi></p> : null}
          {finding.treatmentPlanItemId || finding.performedProcedureId ? <p className="mt-3 flex items-center gap-1 text-xs text-primary"><LinkIcon className="size-3" />{finding.performedProcedureId ? t("linkedCompleted") : t("linkedPlanned")}</p> : null}
          {finding.status === "active" && canWrite ? <FindingStatusActions findingId={finding.id} /> : null}
        </article>) : <div className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">{t("noFindingForTooth")}</div>}
      </div>

      {canWrite ? <details className="h-fit rounded-xl border bg-card p-4" open={findings.length === 0}>
        <summary className="cursor-pointer font-semibold"><span className="inline-flex items-center gap-2"><PlusIcon className="size-4 text-primary" />{t("addFinding")}</span></summary>
        <form action={action} className="mt-4 space-y-3" noValidate>
          <FormError error={state.error} /><input type="hidden" name="toothNumber" value={selectedTooth} /><input type="hidden" name="surfaces" value={surfaces.join(",")} />
          <p className="rounded-lg bg-primary/5 p-2 text-center font-semibold tabular">{t("tooth")} {selectedTooth}</p>
          <SelectField label={t("kind")} name="kind" required defaultValue={state.values?.kind ?? "caries"} options={FINDING_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))} error={state.fieldErrors?.kind} />
          <div><Label>{t("surfaces")}</Label><div className="mt-2 flex flex-wrap gap-1.5">{SURFACES.map((surface) => <Button key={surface} type="button" size="sm" variant={surfaces.includes(surface) ? "secondary" : "outline"} aria-pressed={surfaces.includes(surface)} onClick={() => setSurfaces((current) => current.includes(surface) ? current.filter((item) => item !== surface) : [...current, surface])}>{procedureT(`surfaces.${surface}`)}</Button>)}</div></div>
          <TextField label={t("observedOn")} name="observedOn" type="date" required defaultValue={state.values?.observedOn ?? today} error={state.fieldErrors?.observedOn} />
          <SelectField label={t("provider")} name="providerId" required defaultValue={state.values?.providerId ?? providers[0]?.id} options={providers.map((provider) => ({ value: provider.id, label: [provider.title, provider.displayName].filter(Boolean).join(" ") }))} error={state.fieldErrors?.providerId} />
          <TextAreaField label={t("note")} name="note" optionalLabel rows={3} defaultValue={state.values?.note} error={state.fieldErrors?.note} />
          <SelectField label={t("plannedLink")} name="treatmentPlanItemId" optionalLabel placeholder={t("noLink")} defaultValue={state.values?.treatmentPlanItemId ?? ""} options={planItems.filter((item) => item.toothNumber === selectedTooth).map((item) => ({ value: item.id, label: `${item.planTitle} · ${serviceName(item.serviceSnapshot)}` }))} error={state.fieldErrors?.treatmentPlanItemId} />
          <SelectField label={t("completedLink")} name="performedProcedureId" optionalLabel placeholder={t("noLink")} defaultValue={state.values?.performedProcedureId ?? ""} options={procedures.filter((item) => item.toothNumber === selectedTooth).map((item) => ({ value: item.id, label: `${item.serviceDate} · ${serviceName(item.serviceSnapshot)}` }))} error={state.fieldErrors?.performedProcedureId} />
          <SubmitButton className="w-full">{t("saveFinding")}</SubmitButton>
          {state.ok ? <p className="text-xs font-medium text-success">{t("saved")}</p> : null}
        </form>
      </details> : null}
    </div>
  </section>;
}
