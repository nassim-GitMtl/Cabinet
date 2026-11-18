"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, Trash2Icon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextField, useErrorText } from "@/components/form";
import { Button } from "@/components/ui/button";
import { initialActionState } from "@/lib/action-state";
import {
  confirmConsumptionAction,
  removeRecipeAction,
  setConsumablesModeAction,
  setRecipeAction,
  skipConsumptionAction,
} from "../consumables-actions";

type Option = { value: string; label: string };

export function RecipeForm({ services, items }: { services: Option[]; items: Option[] }) {
  const t = useTranslations("inventory.consumables");
  const [state, action] = useActionState(setRecipeAction, initialActionState);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 sm:items-end">
      <div className="sm:col-span-2"><FormError error={state.error} /></div>
      <SelectField name="serviceId" label={t("service")} required options={services} placeholder={t("chooseService")} error={state.fieldErrors?.serviceId} defaultValue={state.values?.serviceId} />
      <SelectField name="itemId" label={t("item")} required options={items} placeholder={t("chooseItem")} error={state.fieldErrors?.itemId} defaultValue={state.values?.itemId} />
      <TextField name="quantity" type="number" min="1" max="1000" step="1" inputMode="numeric" label={t("perUnit")} required error={state.fieldErrors?.quantity} defaultValue={state.values?.quantity ?? "1"} />
      <SubmitButton disabled={!services.length || !items.length} className="sm:justify-self-start">{t("saveRecipe")}</SubmitButton>
    </form>
  );
}

export function RemoveRecipeButton({ id, label }: { id: string; label: string }) {
  const t = useTranslations("inventory.consumables");
  const [state, action, pending] = useActionState(removeRecipeAction, initialActionState);
  const errorText = useErrorText()(state.error);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {errorText ? <span role="alert" className="text-xs text-destructive">{errorText}</span> : null}
      <Button type="submit" variant="ghost" size="icon-sm" disabled={pending} aria-label={t("removeRecipe", { name: label })} title={t("removeRecipe", { name: label })}>
        <Trash2Icon aria-hidden />
      </Button>
    </form>
  );
}

export function ModeForm({ mode, canManage }: { mode: "suggest" | "auto"; canManage: boolean }) {
  const t = useTranslations("inventory.consumables");
  const [state, action, pending] = useActionState(setConsumablesModeAction, initialActionState);
  return (
    <form action={action} className="grid gap-3">
      <FormError error={state.error} />
      <fieldset className="grid gap-2" disabled={!canManage || pending}>
        <legend className="mb-1 text-sm font-medium">{t("modeTitle")}</legend>
        {(["suggest", "auto"] as const).map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 has-checked:border-primary has-checked:bg-primary/5">
            <input type="radio" name="mode" value={m} defaultChecked={mode === m} className="mt-1 accent-primary" />
            <span>
              <span className="block text-sm font-medium">{t(`mode.${m}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`mode.${m}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {canManage ? <SubmitButton variant="outline" className="justify-self-start">{t("saveMode")}</SubmitButton> : <p className="text-xs text-muted-foreground">{t("modeOwnerOnly")}</p>}
    </form>
  );
}

export function PendingConsumptionActions({ id }: { id: string }) {
  const t = useTranslations("inventory.consumables");
  const [confirmState, confirmAction, confirming] = useActionState(confirmConsumptionAction, initialActionState);
  const [skipState, skipAction] = useActionState(skipConsumptionAction, initialActionState);
  const [skipping, setSkipping] = useState(Boolean(skipState.fieldErrors));
  const errorText = useErrorText()(confirmState.error);
  return (
    <div className="grid gap-2">
      {errorText ? <p role="alert" className="text-xs font-medium text-destructive">{errorText}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <form action={confirmAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" disabled={confirming}>
            <CheckIcon aria-hidden />
            {t("confirm")}
          </Button>
        </form>
        <Button type="button" size="sm" variant="outline" aria-expanded={skipping} onClick={() => setSkipping((v) => !v)}>
          {t("skip")}
        </Button>
      </div>
      {skipping || skipState.fieldErrors || skipState.error ? (
        <form action={skipAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <input type="hidden" name="id" value={id} />
          <div className="sm:col-span-2"><FormError error={skipState.error} /></div>
          <TextField name="reason" label={t("skipReason")} required maxLength={200} dir="auto" error={skipState.fieldErrors?.reason} defaultValue={skipState.values?.reason} />
          <SubmitButton size="sm" variant="outline">{t("skipConfirm")}</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
