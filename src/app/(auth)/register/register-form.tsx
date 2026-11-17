"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { registerAction } from "@/features/auth/actions";
import { initialActionState } from "@/lib/action-state";

const KINDS = ["solo", "group", "specialist", "pediatric", "multi_branch"] as const;

export function RegisterForm() {
  const t = useTranslations("auth");
  const [state, action] = useActionState(registerAction, initialActionState);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={t("clinicName")} name="clinicName" required autoComplete="organization" defaultValue={v.clinicName} error={state.fieldErrors?.clinicName} />
      <SelectField
        label={t("clinicKind")}
        name="kind"
        defaultValue={v.kind ?? "solo"}
        options={KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
        error={state.fieldErrors?.kind}
      />
      <TextField label={t("fullName")} name="ownerFullName" required autoComplete="name" defaultValue={v.ownerFullName} error={state.fieldErrors?.ownerFullName} />
      <TextField label={t("email")} name="email" type="email" inputMode="email" autoComplete="email" required defaultValue={v.email} error={state.fieldErrors?.email} />
      <TextField
        label={t("password")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint={t("passwordHint")}
        error={state.fieldErrors?.password}
      />
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Checkbox id="ownerIsDentist" name="ownerIsDentist" defaultChecked={v.ownerIsDentist !== undefined ? v.ownerIsDentist === "on" : true} />
        <Label htmlFor="ownerIsDentist" className="text-sm leading-snug font-normal">
          {t("ownerIsDentist")}
        </Label>
      </div>
      <SubmitButton className="w-full" size="lg">
        {t("createClinic")}
      </SubmitButton>
    </form>
  );
}
