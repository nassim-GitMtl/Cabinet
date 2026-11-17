"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { acceptStaffInvitationAction } from "@/features/access/actions";
import { initialActionState } from "@/lib/action-state";

export function StaffInvitationForm({ token, existingUser }: { token: string; existingUser: boolean }) {
  const t = useTranslations("access"); const [state, action] = useActionState(acceptStaffInvitationAction.bind(null, token), initialActionState);
  return <form action={action} className="space-y-4" noValidate><FormError error={state.error} />
    <TextField label={existingUser ? t("existingPassword") : t("newPassword")} name="password" type="password" autoComplete={existingUser ? "current-password" : "new-password"} required error={state.fieldErrors?.password} />
    <TextField label={t("confirmPassword")} name="confirmPassword" type="password" autoComplete="new-password" required error={state.fieldErrors?.confirmPassword} />
    <SubmitButton className="w-full">{t("acceptInvitation")}</SubmitButton>
  </form>;
}
