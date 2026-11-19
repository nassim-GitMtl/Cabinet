"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { initialActionState, type ActionState } from "@/lib/action-state";

export function SterilizationActionForm({ action, hidden, label, requireReason = false, biological = false, destructive = false }: { action: (state: ActionState, data: FormData) => Promise<ActionState>; hidden: Record<string, string>; label: string; requireReason?: boolean; biological?: boolean; destructive?: boolean }) {
  const t = useTranslations("sterilization"); const [state, formAction] = useActionState(action, initialActionState);
  return <form action={formAction} className="grid gap-2 rounded-xl border p-3"><FormError error={state.error} />
    {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    {biological ? <SelectField name="result" label={t("fields.biologicalResult")} options={[{ value: "pass", label: t("indicator.pass") }, { value: "fail", label: t("indicator.fail") }]} defaultValue="pass" /> : null}
    <TextField name="reason" label={requireReason ? t("fields.reason") : t("fields.note")} required={requireReason} optionalLabel={!requireReason} error={state.fieldErrors?.reason} />
    <SubmitButton variant={destructive ? "destructive" : "default"}>{label}</SubmitButton>
  </form>;
}
