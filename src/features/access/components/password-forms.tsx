"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2Icon, CheckIcon, CopyIcon, KeyRoundIcon } from "lucide-react";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { changeOwnPasswordAction, createStaffPasswordResetAction, requestPasswordResetAction, resetStaffPasswordAction } from "@/features/access/password-actions";
import { initialActionState } from "@/lib/action-state";

/** Public page: choose the new password from a single-use link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("passwordReset");
  const [state, action] = useActionState(resetStaffPasswordAction.bind(null, token), initialActionState);
  return <form action={action} className="space-y-4" noValidate>
    <FormError error={state.error} />
    <TextField label={t("newPassword")} name="password" type="password" autoComplete="new-password" required hint={t("passwordHint")} error={state.fieldErrors?.password} />
    <TextField label={t("confirmPassword")} name="confirmPassword" type="password" autoComplete="new-password" required error={state.fieldErrors?.confirmPassword} />
    <SubmitButton className="w-full" size="lg">{t("save")}</SubmitButton>
  </form>;
}

/** Public page: ask for an emailed link (only rendered when SMTP is configured). */
export function ForgotPasswordForm() {
  const t = useTranslations("passwordReset");
  const [state, action] = useActionState(requestPasswordResetAction, initialActionState);
  if (state.ok) {
    return <div className="flex gap-3 rounded-lg border border-success/40 bg-success/10 p-4 text-sm" role="status">
      <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
      <p>{t("emailSent")}</p>
    </div>;
  }
  return <form action={action} className="space-y-4" noValidate>
    <FormError error={state.error} />
    <TextField label={t("emailLabel")} name="email" type="email" autoComplete="username" inputMode="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
    <SubmitButton className="w-full" size="lg">{t("sendLink")}</SubmitButton>
  </form>;
}

/** Settings → security: change your own password (other devices are signed out). */
export function ChangePasswordForm() {
  const t = useTranslations("passwordReset");
  const [state, action] = useActionState(changeOwnPasswordAction, initialActionState);
  return <section className="rounded-xl border bg-card p-5">
    <h2 className="font-semibold">{t("changeTitle")}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("changeHint")}</p>
    <form key={state.ok ? "done" : "form"} action={action} className="mt-4 space-y-3" noValidate>
      <FormError error={state.error} />
      {state.ok ? <p className="flex items-center gap-2 text-sm text-success" role="status"><CheckCircle2Icon className="size-4" aria-hidden />{t("changed")}</p> : null}
      <TextField label={t("currentPassword")} name="currentPassword" type="password" autoComplete="current-password" required error={state.fieldErrors?.currentPassword} />
      <TextField label={t("newPassword")} name="password" type="password" autoComplete="new-password" required hint={t("passwordHint")} error={state.fieldErrors?.password} />
      <TextField label={t("confirmPassword")} name="confirmPassword" type="password" autoComplete="new-password" required error={state.fieldErrors?.confirmPassword} />
      <SubmitButton>{t("changeSubmit")}</SubmitButton>
    </form>
  </section>;
}

/** Team page: owner/admin creates a single-use link for a colleague who forgot their password. */
export function MemberResetLink({ membershipId }: { membershipId: string }) {
  const t = useTranslations("passwordReset");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, action] = useActionState(createStaffPasswordResetAction.bind(null, membershipId), initialActionState);
  const link = state.data as { path: string; expiresAt: string } | undefined;
  if (!open) {
    return <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(true)}><KeyRoundIcon />{t("adminOpen")}</Button>;
  }
  return <div className="mt-3 rounded-lg border border-dashed p-3 text-sm">
    <p className="font-medium">{t("adminTitle")}</p>
    <p className="mt-1 text-xs text-muted-foreground">{t("adminHint")}</p>
    {link ? <div className="mt-3 rounded-lg bg-primary/5 p-3 text-xs">
      <code className="block break-all" dir="ltr">{link.path}</code>
      <p className="mt-1 text-muted-foreground">{t("adminExpires", { date: new Date(link.expiresAt) })}</p>
      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={async () => { await navigator.clipboard.writeText(`${location.origin}${link.path}`); setCopied(true); }}>
        {copied ? <CheckIcon /> : <CopyIcon />}{copied ? t("copied") : t("copy")}
      </Button>
    </div> : <form action={action} className="mt-3 space-y-3">
      <FormError error={state.error} />
      <label className="flex items-start gap-2 text-xs"><Checkbox name="resetMfa" className="mt-0.5" /><span>{t("adminResetMfa")}</span></label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm">{t("adminCreate")}</SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
    </form>}
  </div>;
}
