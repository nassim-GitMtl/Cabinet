"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { initialActionState } from "@/lib/action-state";
import { linkSterilizationPackAction, voidSterilizationPackUseAction } from "../actions";

export function LinkPackForm({ packId, patientId, usedOn, procedures }: { packId: string; patientId: string; usedOn: string; procedures: { value: string; label: string }[] }) {
  const t = useTranslations("sterilization"); const [state, action] = useActionState(linkSterilizationPackAction, initialActionState);
  return <form action={action} className="mt-3 grid gap-3 rounded-xl border bg-background p-3 sm:grid-cols-2"><FormError error={state.error} />
    <input type="hidden" name="packId" value={packId} /><input type="hidden" name="patientId" value={patientId} />
    <TextField type="date" name="usedOn" label={t("fields.usedOn")} defaultValue={usedOn} required error={state.fieldErrors?.usedOn} />
    <SelectField name="performedProcedureId" label={t("fields.procedure")} options={procedures} placeholder={t("patient.noProcedure")} optionalLabel />
    <SubmitButton className="sm:col-span-2">{t("actions.linkPack")}</SubmitButton>
  </form>;
}

export function VoidPackUseForm({ useId }: { useId: string }) {
  const t = useTranslations("sterilization"); const [state, action] = useActionState(voidSterilizationPackUseAction, initialActionState);
  return <form action={action} className="mt-2 flex flex-wrap items-end gap-2"><FormError error={state.error} /><input type="hidden" name="useId" value={useId} /><TextField name="reason" label={t("fields.reason")} required error={state.fieldErrors?.reason} fieldClassName="min-w-52 flex-1" /><SubmitButton variant="destructive">{t("actions.voidUse")}</SubmitButton></form>;
}
