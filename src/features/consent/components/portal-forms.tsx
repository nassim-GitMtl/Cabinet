"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { activatePortalAction, decideConsentRequestAction, patientLoginAction, patientLogoutAction, revokeConsentGrantAction } from "@/features/consent/portal-actions";
import { initialActionState } from "@/lib/action-state";

export function PortalLoginForm() {
  const t = useTranslations("portal");
  const [state, action] = useActionState(patientLoginAction, initialActionState);
  return <form action={action} className="space-y-4" noValidate>
    <FormError error={state.error} />
    <TextField label={t("email")} name="email" type="email" autoComplete="username" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
    <TextField label={t("password")} name="password" type="password" autoComplete="current-password" required error={state.fieldErrors?.password} />
    <SubmitButton className="w-full" size="lg">{t("signIn")}</SubmitButton>
  </form>;
}

export function PortalActivationForm({ token }: { token: string }) {
  const t = useTranslations("portal");
  const [state, action] = useActionState(activatePortalAction.bind(null, token), initialActionState);
  return <form action={action} className="space-y-4" noValidate>
    <FormError error={state.error} />
    <TextField label={t("password")} name="password" type="password" autoComplete="new-password" required hint={t("passwordHint")} error={state.fieldErrors?.password} />
    <TextField label={t("confirmPassword")} name="confirmPassword" type="password" autoComplete="new-password" required error={state.fieldErrors?.confirmPassword} />
    <SubmitButton className="w-full" size="lg">{t("activate")}</SubmitButton>
  </form>;
}

export function LogoutButton() {
  const t = useTranslations("portal");
  return <form action={patientLogoutAction}><Button type="submit" variant="outline" size="sm">{t("logout")}</Button></form>;
}

export function ConsentDecisionButtons({ requestId }: { requestId: string }) {
  const t = useTranslations("portal");
  const [approve, approveAction] = useActionState(decideConsentRequestAction.bind(null, requestId, "approved"), initialActionState);
  const [decline, declineAction] = useActionState(decideConsentRequestAction.bind(null, requestId, "declined"), initialActionState);
  return <div className="mt-4 flex flex-wrap gap-2">
    <form action={approveAction}><SubmitButton>{t("approve")}</SubmitButton></form>
    <form action={declineAction}><SubmitButton variant="outline">{t("decline")}</SubmitButton></form>
    <FormError error={approve.error ?? decline.error} />
  </div>;
}

export function RevokeGrantForm({ grantId }: { grantId: string }) {
  const t = useTranslations("portal");
  const [state, action] = useActionState(revokeConsentGrantAction.bind(null, grantId), initialActionState);
  return <form action={action} className="mt-4 space-y-2">
    <FormError error={state.error} />
    <TextField label={t("revokeReason")} name="reason" optionalLabel />
    <SubmitButton variant="destructive">{t("revoke")}</SubmitButton>
  </form>;
}
