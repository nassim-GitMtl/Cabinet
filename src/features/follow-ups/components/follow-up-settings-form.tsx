"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { initialActionState } from "@/lib/action-state";
import { saveFollowUpSettingsAction } from "../actions";
import { FOLLOW_UP_REASONS, MAX_TEMPLATE_LENGTH, MESSAGE_LOCALES, TEMPLATE_PLACEHOLDERS, type FollowUpReason, type MessageLocale } from "../messages";

const REASON_TAB: Record<FollowUpReason, string> = {
  appointment_reminder: "reminders", recall: "recall", treatment_followup: "treatments", estimate_followup: "estimates", no_show: "noShows",
  after_visit: "afterVisit", referral_thanks: "thanks", installment_due: "installments",
};

export function FollowUpSettingsForm({ recallMonths, branches, custom, defaults, reviewUrl, categories, aftercare }: {
  recallMonths: number;
  branches: { id: string; name: string; phone: string }[];
  reviewUrl: string;
  categories: { id: string; name: string }[];
  aftercare: Record<string, Partial<Record<MessageLocale, string>>>;
  custom: Partial<Record<FollowUpReason, Partial<Record<MessageLocale, string>>>>;
  defaults: Record<FollowUpReason, Record<MessageLocale, string>>;
}) {
  const t = useTranslations("followUps");
  const [state, action] = useActionState(saveFollowUpSettingsAction, initialActionState);
  const value = (name: string, fallback: string) => state.values?.[name] ?? fallback;

  return (
    <form action={action} className="grid gap-5">
      <FormError error={state.error} />
      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:grid-cols-2 sm:p-5">
        <TextField name="recallMonths" type="number" min="3" max="24" step="1" inputMode="numeric" required label={t("settings.recallMonths")}
          defaultValue={value("recallMonths", String(recallMonths))} error={state.fieldErrors?.recallMonths} />
        <div className="grid gap-3">
          <p className="text-sm font-medium">{t("settings.phonesTitle")}</p>
          {branches.map((b, index) => (
            <TextField key={b.id} name={`branchPhone.${b.id}`} type="tel" inputMode="tel" dir="ltr" label={t("settings.branchPhone", { branch: b.name })}
              placeholder="0550 00 00 00" defaultValue={value(`branchPhone.${b.id}`, b.phone)} error={state.fieldErrors?.[`branchPhones.${index}`]} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <TextField name="reviewUrl" type="url" dir="ltr" label={t("settings.reviewUrl")} optionalLabel placeholder="https://g.page/r/…"
          hint={t("settings.reviewUrlHint")} defaultValue={value("reviewUrl", reviewUrl)} error={state.fieldErrors?.reviewUrl} />
        <div>
          <h2 className="font-semibold">{t("settings.aftercareTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.aftercareHint")}</p>
        </div>
        <div className="grid gap-2">
          {categories.map((c) => {
            const filled = MESSAGE_LOCALES.some((l) => aftercare[c.id]?.[l]);
            return (
              <details key={c.id} className="rounded-xl border p-3" open={filled}>
                <summary className="cursor-pointer text-sm font-medium"><bdi>{c.name}</bdi>{filled ? " ✓" : ""}</summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {MESSAGE_LOCALES.map((locale) => (
                    <TextAreaField key={locale} name={`aftercare.${c.id}.${locale}`} label={t(`settings.locales.${locale}`)} optionalLabel rows={3} maxLength={500}
                      dir={locale === "ar" ? "rtl" : "ltr"} defaultValue={value(`aftercare.${c.id}.${locale}`, aftercare[c.id]?.[locale] ?? "")} />
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div>
          <h2 className="font-semibold">{t("settings.templatesTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.templatesHint")}{" "}
            {TEMPLATE_PLACEHOLDERS.map((p) => <code key={p} dir="ltr" className="me-1 rounded bg-muted px-1 py-0.5 text-xs">{`{${p}}`}</code>)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.bookingLinkHint")}</p>
        </div>
        {FOLLOW_UP_REASONS.map((reason) => (
          <fieldset key={reason} className="grid gap-3 rounded-xl border p-3">
            <legend className="px-1 text-sm font-semibold">{t(`tabs.${REASON_TAB[reason]}` as "tabs.reminders")}</legend>
            <div className="grid gap-3 lg:grid-cols-3">
              {MESSAGE_LOCALES.map((locale) => (
                <TextAreaField key={locale} name={`templates.${reason}.${locale}`} label={t(`settings.locales.${locale}`)} optionalLabel
                  dir={locale === "ar" ? "rtl" : "ltr"} rows={5} maxLength={MAX_TEMPLATE_LENGTH} placeholder={defaults[reason][locale]}
                  defaultValue={value(`templates.${reason}.${locale}`, custom[reason]?.[locale] ?? "")}
                  error={state.fieldErrors?.[`templates.${reason}.${locale}`]} />
              ))}
            </div>
          </fieldset>
        ))}
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton>{t("settings.save")}</SubmitButton>
        {state.ok ? <span role="status" className="text-sm text-success">{t("settings.saved")}</span> : null}
      </div>
    </form>
  );
}
