"use client";

import { useActionState } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FormError, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { submitTrialRequestAction } from "@/features/trials/actions";
import { initialActionState } from "@/lib/action-state";

export function TrialForm() {
  const t = useTranslations("trial");
  const locale = useLocale();
  const [state, action] = useActionState(submitTrialRequestAction, initialActionState);
  if (state.ok) {
    return <div role="status" className="rounded-xl border border-success/40 bg-success/10 p-5">
      <p className="flex items-center gap-2 font-semibold"><CheckCircle2Icon className="size-5 text-success" aria-hidden />{t("sentTitle")}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t("sentBody")}</p>
    </div>;
  }
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
    <div className="sm:col-span-2"><FormError error={state.error} /></div>
    <input type="hidden" name="locale" value={locale} />
    {/* Left empty by people; robots fill it in. */}
    <div hidden aria-hidden><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label></div>
    <TextField fieldClassName="sm:col-span-2" label={t("clinicName")} name="clinicName" required autoComplete="organization" maxLength={160} defaultValue={v.clinicName} error={e.clinicName} />
    <TextField label={t("contactName")} name="contactName" required autoComplete="name" maxLength={120} defaultValue={v.contactName} error={e.contactName} />
    <TextField label={t("phone")} name="phone" type="tel" inputMode="tel" required autoComplete="tel" dir="ltr" placeholder="0550 12 34 56" defaultValue={v.phone} error={e.phone} />
    <TextField label={t("email")} name="email" type="email" inputMode="email" required autoComplete="email" dir="ltr" maxLength={200} defaultValue={v.email} error={e.email} />
    <TextField label={t("city")} name="city" optionalLabel autoComplete="address-level2" maxLength={120} defaultValue={v.city} error={e.city} />
    <TextField label={t("practitioners")} name="practitioners" type="number" inputMode="numeric" min={1} max={100} optionalLabel defaultValue={v.practitioners} error={e.practitioners} />
    <TextAreaField fieldClassName="sm:col-span-2" label={t("message")} name="message" optionalLabel rows={3} maxLength={1000} hint={t("messageHint")} defaultValue={v.message} error={e.message} />
    <p className="text-xs text-muted-foreground sm:col-span-2">{t("privacy")}</p>
    <SubmitButton className="sm:col-span-2">{t("submit")}</SubmitButton>
  </form>;
}
