"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlertIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { ButtonLink } from "@/components/button-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { formatDateOnly } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import type { DuplicateCandidate } from "../server";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: Record<string, string>;
  providers: { id: string; label: string }[];
  submitLabel: string;
  cancelHref: string;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border bg-card p-4 sm:p-6">
      <legend className="px-1 text-base font-semibold">{title}</legend>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function PatientForm({ action, defaults = {}, providers, submitLabel, cancelHref }: Props) {
  const t = useTranslations("patients");
  const tc = useTranslations("common");
  const [state, formAction] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const v = state.values ?? defaults;
  const fe = state.fieldErrors ?? {};
  const duplicates = (state.data as { duplicates?: DuplicateCandidate[] } | undefined)?.duplicates;
  const feedbackRef = useRef<HTMLDivElement>(null);

  // Errors and duplicate warnings render at the top: bring them into view.
  useEffect(() => {
    if (state.error || duplicates?.length) {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      feedbackRef.current?.focus({ preventScroll: true });
    }
  }, [state, duplicates]);

  return (
    <form ref={formRef} action={formAction} className="space-y-6" noValidate>
      <input ref={confirmRef} type="hidden" name="confirmNotDuplicate" defaultValue="" />
      <div ref={feedbackRef} tabIndex={-1} className="scroll-mt-20 space-y-4 outline-none">
      <FormError error={state.error} />

      {duplicates?.length ? (
        <Alert className="border-warning/60 bg-warning/10" role="alert">
          <TriangleAlertIcon className="text-warning-foreground" aria-hidden />
          <AlertTitle>{t("duplicatesTitle")}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{t("duplicatesBody")}</p>
            <ul className="divide-y rounded-lg border bg-background">
              {duplicates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    <span className="font-medium">
                      {d.lastName} {d.firstName}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {d.patientNumber}
                      {d.birthDate ? ` · ${formatDateOnly(d.birthDate)}` : ""}
                      {d.phone ? ` · ${formatPhone(d.phone)}` : ""}
                    </span>
                  </span>
                  <ButtonLink href={`/patients/${d.id}`} size="sm" variant="outline">
                    {t("openExisting")}
                  </ButtonLink>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirmRef.current) confirmRef.current.value = "1";
                formRef.current?.requestSubmit();
              }}
            >
              {t("createAnyway")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      </div>

      <Section title={t("sections.identity")}>
        <TextField label={t("fields.lastName")} name="lastName" required autoComplete="off" defaultValue={v.lastName} error={fe.lastName} />
        <TextField label={t("fields.firstName")} name="firstName" required autoComplete="off" defaultValue={v.firstName} error={fe.firstName} />
        <TextField label={t("fields.lastNameAr")} name="lastNameAr" dir="rtl" lang="ar" optionalLabel defaultValue={v.lastNameAr} error={fe.lastNameAr} />
        <TextField label={t("fields.firstNameAr")} name="firstNameAr" dir="rtl" lang="ar" optionalLabel defaultValue={v.firstNameAr} error={fe.firstNameAr} />
        <TextField
          label={t("fields.birthDate")}
          name="birthDate"
          placeholder="JJ/MM/AAAA"
          inputMode="numeric"
          autoComplete="off"
          optionalLabel
          defaultValue={v.birthDate}
          error={fe.birthDate}
        />
        <SelectField
          label={t("fields.birthDatePrecision")}
          name="birthDatePrecision"
          defaultValue={v.birthDatePrecision ?? "exact"}
          options={(["exact", "year", "estimated"] as const).map((p) => ({ value: p, label: t(`precision.${p}`) }))}
        />
        <SelectField
          label={t("fields.sex")}
          name="sex"
          optionalLabel
          placeholder={tc("notSet")}
          defaultValue={v.sex}
          options={(["female", "male", "other", "undisclosed"] as const).map((s) => ({ value: s, label: t(`sex.${s}`) }))}
        />
        <SelectField
          label={t("fields.preferredLocale")}
          name="preferredLocale"
          defaultValue={v.preferredLocale ?? "fr"}
          options={(["fr", "ar", "en"] as const).map((l) => ({ value: l, label: t(`locales.${l}`) }))}
        />
      </Section>

      <Section title={t("sections.contact")}>
        <TextField label={t("fields.phone")} name="phone" type="tel" inputMode="tel" autoComplete="off" optionalLabel defaultValue={v.phone} error={fe.phone} />
        <TextField label={t("fields.phoneAlt")} name="phoneAlt" type="tel" inputMode="tel" autoComplete="off" optionalLabel defaultValue={v.phoneAlt} error={fe.phoneAlt} />
        <TextField label={t("fields.email")} name="email" type="email" inputMode="email" autoComplete="off" optionalLabel defaultValue={v.email} error={fe.email} />
        <TextField label={t("fields.address")} name="addressLine" autoComplete="off" optionalLabel defaultValue={v.addressLine} error={fe.addressLine} />
        <TextField label={t("fields.city")} name="city" autoComplete="off" optionalLabel defaultValue={v.city} error={fe.city} />
        <TextField label={t("fields.region")} name="region" autoComplete="off" optionalLabel defaultValue={v.region} error={fe.region} />
      </Section>

      <Section title={t("sections.emergency")}>
        <TextField label={t("fields.emergencyName")} name="emergencyName" autoComplete="off" optionalLabel defaultValue={v.emergencyName} error={fe.emergencyName} />
        <TextField label={t("fields.emergencyRelationship")} name="emergencyRelationship" autoComplete="off" optionalLabel defaultValue={v.emergencyRelationship} />
        <TextField label={t("fields.emergencyPhone")} name="emergencyPhone" type="tel" inputMode="tel" autoComplete="off" optionalLabel defaultValue={v.emergencyPhone} error={fe.emergencyPhone} />
      </Section>

      <Section title={t("sections.administrative")}>
        <SelectField
          label={t("fields.assignedProvider")}
          name="assignedProviderId"
          optionalLabel
          placeholder={tc("none")}
          defaultValue={v.assignedProviderId}
          options={providers.map((p) => ({ value: p.id, label: p.label }))}
        />
        <TextField label={t("fields.referralSource")} name="referralSource" autoComplete="off" optionalLabel defaultValue={v.referralSource} />
        <TextField label={t("fields.referredBy")} name="referredBy" autoComplete="off" optionalLabel defaultValue={v.referredBy} />
        <TextAreaField
          label={t("fields.administrativeNotes")}
          name="administrativeNotes"
          hint={t("fields.administrativeNotesHint")}
          optionalLabel
          fieldClassName="sm:col-span-2"
          rows={3}
          defaultValue={v.administrativeNotes}
        />
      </Section>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 lg:bottom-0">
        <SubmitButton size="lg" className="flex-1 sm:flex-none">
          {submitLabel}
        </SubmitButton>
        <ButtonLink href={cancelHref} variant="outline" size="lg">
          {tc("cancel")}
        </ButtonLink>
      </div>
    </form>
  );
}

