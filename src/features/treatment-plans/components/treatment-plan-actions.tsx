"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, SendIcon, StethoscopeIcon, XIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { initialActionState } from "@/lib/action-state";
import { decideTreatmentPlanAction, proposeTreatmentPlanAction, convertTreatmentPlanItemAction } from "../actions";

export function ProposePlanForm({ planId, expectedVersion }: { planId: string; expectedVersion: number }) {
  const t = useTranslations("treatmentPlans");
  const [state, action] = useActionState(proposeTreatmentPlanAction.bind(null, planId, expectedVersion), initialActionState);
  return <form action={action} className="space-y-2">
    <FormError error={state.error} />
    <SubmitButton><SendIcon aria-hidden />{t("propose")}</SubmitButton>
  </form>;
}

export function DecisionForms({ planId, expectedVersion }: { planId: string; expectedVersion: number }) {
  return <div className="grid gap-3 md:grid-cols-2">
    <DecisionForm planId={planId} expectedVersion={expectedVersion} decision="accepted" />
    <DecisionForm planId={planId} expectedVersion={expectedVersion} decision="declined" />
  </div>;
}

function DecisionForm({ planId, expectedVersion, decision }: { planId: string; expectedVersion: number; decision: "accepted" | "declined" }) {
  const t = useTranslations("treatmentPlans");
  const [state, action] = useActionState(decideTreatmentPlanAction.bind(null, planId), initialActionState);
  return <form action={action} className="space-y-3 rounded-xl border bg-muted/25 p-3">
    <FormError error={state.error} />
    <input type="hidden" name="expectedVersion" value={expectedVersion} />
    <input type="hidden" name="decision" value={decision} />
    <SelectField label={t("decisionMethod")} name="method" required defaultValue="signed_in_clinic"
      options={(["signed_in_clinic", "verbal", "other"] as const).map((value) => ({ value, label: t(`methods.${value}`) }))}
      error={state.fieldErrors?.method} />
    <TextAreaField label={t("decisionNote")} name="note" rows={2} optionalLabel error={state.fieldErrors?.note} />
    <SubmitButton variant={decision === "accepted" ? "default" : "outline"}>
      {decision === "accepted" ? <CheckIcon aria-hidden /> : <XIcon aria-hidden />}{t(decision)}
    </SubmitButton>
  </form>;
}

export function ConvertItemForm({ planId, itemId, expectedVersion, providers, branches, defaultProviderId, defaultBranchId, defaultDate }: {
  planId: string; itemId: string; expectedVersion: number; providers: { id: string; name: string }[]; branches: { id: string; name: string }[];
  defaultProviderId: string; defaultBranchId: string; defaultDate: string;
}) {
  const t = useTranslations("treatmentPlans");
  const [state, action] = useActionState(convertTreatmentPlanItemAction.bind(null, planId, itemId), initialActionState);
  return <form action={action} className="mt-3 space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
    <FormError error={state.error} />
    <input type="hidden" name="expectedVersion" value={expectedVersion} />
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField label={t("serviceDate")} name="serviceDate" type="date" required max={defaultDate} defaultValue={defaultDate} error={state.fieldErrors?.serviceDate} />
      <SelectField label={t("provider")} name="performingProviderId" required defaultValue={defaultProviderId}
        options={providers.map((row) => ({ value: row.id, label: row.name }))} error={state.fieldErrors?.performingProviderId} />
      {branches.length > 1 ? <SelectField label={t("branch")} name="branchId" required defaultValue={defaultBranchId}
        options={branches.map((row) => ({ value: row.id, label: row.name }))} error={state.fieldErrors?.branchId} />
        : <input type="hidden" name="branchId" value={defaultBranchId} />}
    </div>
    <SubmitButton size="sm"><StethoscopeIcon aria-hidden />{t("recordPerformed")}</SubmitButton>
  </form>;
}
