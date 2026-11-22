"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { FormError, SubmitButton, TextAreaField, TextField, useErrorText } from "@/components/form";
import { FilePicker } from "@/components/file-picker";
import { Button } from "@/components/ui/button";
import { initialActionState } from "@/lib/action-state";
import { saveClinicIdentityAction, saveClinicLogoAction } from "../actions";

const IDENTIFIERS = ["NIF", "NIS", "RC", "AI"] as const;

export function ClinicIdentityForm({ saved }: {
  saved: { clinicName: string; legalName: string; address: string; identifiers: Record<string, string>; phone: string; email: string };
}) {
  const t = useTranslations("clinicIdentity");
  const [state, action] = useActionState(saveClinicIdentityAction, initialActionState);
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="font-semibold">{t("identityTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("identityHint")}</p>
      </div>
      <FormError error={state.error} />
      {state.ok ? <p role="status" className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm font-medium text-success">{t("saved")}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="clinicName" label={t("clinicName")} required hint={t("clinicNameHint")} dir="auto" defaultValue={v?.clinicName ?? saved.clinicName} error={fe.clinicName} />
        <TextField name="legalName" label={t("legalName")} required hint={t("legalNameHint")} dir="auto" defaultValue={v?.legalName ?? saved.legalName} error={fe.legalName} />
        <div className="sm:col-span-2">
          <TextAreaField name="address" label={t("address")} optionalLabel rows={2} dir="auto" defaultValue={v?.address ?? saved.address} error={fe.address} />
        </div>
        <TextField name="phone" type="tel" inputMode="tel" dir="ltr" label={t("phone")} optionalLabel placeholder="0550 00 00 00" defaultValue={v?.phone ?? saved.phone} error={fe.phone} />
        <TextField name="email" type="email" inputMode="email" dir="ltr" label={t("email")} optionalLabel defaultValue={v?.email ?? saved.email} error={fe.email} />
      </div>
      <fieldset className="grid gap-3 rounded-xl border p-3">
        <legend className="px-1 text-sm font-semibold">{t("identifiersTitle")}</legend>
        <p className="text-xs text-muted-foreground">{t("identifiersHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {IDENTIFIERS.map((key) => (
            <TextField key={key} name={`identifiers.${key}`} label={t(`identifiers.${key}`)} optionalLabel dir="ltr" autoComplete="off"
              defaultValue={v?.[`identifiers.${key}`] ?? saved.identifiers[key] ?? ""} error={fe[`identifiers.${key}`]} />
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">{t("frozenHint")}</p>
      <SubmitButton className="justify-self-start">{t("save")}</SubmitButton>
    </form>
  );
}

export function ClinicLogoForm({ logoVersion }: { logoVersion: string | null }) {
  const t = useTranslations("clinicIdentity");
  const errorText = useErrorText();
  const [state, action, pending] = useActionState(saveClinicLogoAction, initialActionState);
  const error = state.fieldErrors?.logo ?? state.error;
  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="font-semibold">{t("logoTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("logoHint")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border bg-muted">
          {logoVersion ? (
            // eslint-disable-next-line @next/next/no-img-element -- versioned private route
            <img src={`/api/clinic/logo?v=${logoVersion}`} alt={t("logoTitle")} className="max-h-full max-w-full object-contain" />
          ) : <ImageIcon className="size-8 text-muted-foreground" aria-hidden />}
        </div>
        <form action={action} className="flex flex-wrap items-end gap-2">
          <FilePicker id="clinic-logo" name="logo" accept="image/png,image/jpeg,image/webp" label={t("chooseLogo")} required className="w-64 max-w-full" />
          <Button type="submit" variant="outline" disabled={pending}><UploadIcon aria-hidden />{t("uploadLogo")}</Button>
        </form>
        {logoVersion ? (
          <form action={action}>
            <input type="hidden" name="remove" value="1" />
            <Button type="submit" variant="ghost" disabled={pending}><Trash2Icon aria-hidden />{t("removeLogo")}</Button>
          </form>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{errorText(error)}</p> : null}
    </section>
  );
}
