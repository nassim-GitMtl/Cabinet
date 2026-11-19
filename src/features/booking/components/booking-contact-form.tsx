"use client";

import { ACQUISITION_CHANNELS } from "@/lib/acquisition";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField, useErrorText } from "@/components/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { initialActionState } from "@/lib/action-state";
import { submitBookingAction } from "../actions";

export function BookingContactForm({ token, slot }: { token: string; slot: { typeId: string; providerId: string; date: string; time: string } }) {
  const t = useTranslations("booking");
  const ta = useTranslations("acquisition");
  const errorText = useErrorText();
  const [state, action] = useActionState(submitBookingAction.bind(null, token, slot), initialActionState);
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      {/* Honeypot: hidden from people, tempting for bots. */}
      <div aria-hidden className="absolute -start-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <TextField label={t("contactName")} name="contactName" required autoComplete="name" defaultValue={v.contactName} error={fe.contactName} />
      <TextField label={t("contactPhone")} name="contactPhone" type="tel" inputMode="tel" required autoComplete="tel" defaultValue={v.contactPhone} error={fe.contactPhone} hint={t("phoneHint")} />
      <TextField label={t("contactEmail")} name="contactEmail" type="email" inputMode="email" optionalLabel autoComplete="email" defaultValue={v.contactEmail} />
      <SelectField
        label={t("existing")}
        name="existing"
        defaultValue={v.existing ?? "no"}
        options={[
          { value: "no", label: t("existingNo") },
          { value: "yes", label: t("existingYes") },
        ]}
      />
      <SelectField
        label={ta("questionPublic")}
        name="acquisitionChannel"
        optionalLabel
        placeholder={ta("preferNotToSay")}
        defaultValue={v.acquisitionChannel}
        options={ACQUISITION_CHANNELS.map((c) => ({ value: c, label: ta(`channelsPublic.${c}`) }))}
      />
      <TextAreaField label={t("message")} name="message" optionalLabel rows={2} defaultValue={v.message} hint={t("messageHint")} />
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Checkbox id="booking-consent" name="consent" defaultChecked={v.consent === "on"} aria-invalid={fe.consent ? true : undefined} />
        <Label htmlFor="booking-consent" className="text-sm leading-snug font-normal">
          {t("consent")}
        </Label>
      </div>
      {fe.consent ? <p className="text-xs font-medium text-destructive">{errorText("required")}</p> : null}
      <SubmitButton size="lg" className="w-full">
        {t("submit")}
      </SubmitButton>
      <p className="text-xs text-muted-foreground">{t("pendingNote")}</p>
    </form>
  );
}
