"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { loginAction } from "@/features/auth/actions";
import { verifyLoginMfaAction } from "@/features/auth/actions";
import { initialActionState } from "@/lib/action-state";

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, action] = useActionState(loginAction, initialActionState);
  const token = (state.data as { mfaToken?: string } | undefined)?.mfaToken;
  if (token) return <MfaLoginForm token={token} />;
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

function MfaLoginForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState(verifyLoginMfaAction.bind(null, token), initialActionState);
  return <form action={action} className="space-y-4" noValidate>
    <p className="text-sm text-muted-foreground">{t("mfaPrompt")}</p>
    <FormError error={state.error} />
    <TextField label={t("mfaCode")} name="code" inputMode="numeric" autoComplete="one-time-code" required error={state.fieldErrors?.code} />
    <SubmitButton className="w-full" size="lg">{t("verify")}</SubmitButton>
  </form>;
}
