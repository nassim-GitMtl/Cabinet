"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { loginAction } from "@/features/auth/actions";
import { initialActionState } from "@/lib/action-state";

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, action] = useActionState(loginAction, initialActionState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField
        label={t("email")}
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <TextField
        label={t("password")}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
      />
      <SubmitButton className="w-full" size="lg">
        {t("signIn")}
      </SubmitButton>
    </form>
  );
}
