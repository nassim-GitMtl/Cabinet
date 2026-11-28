"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MessageCircleIcon, SendIcon } from "lucide-react";
import { FormError, SubmitButton, TextField, useErrorText } from "@/components/form";
import { Button } from "@/components/ui/button";
import { initialActionState } from "@/lib/action-state";
import { sendTestReminderAction, setAutoRemindersAction } from "../actions";

/** On/off switch of the clinic's automatic WhatsApp reminders. */
export function AutoReminderToggle({ enabled, disabled }: { enabled: boolean; disabled: boolean }) {
  const t = useTranslations("reminders");
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, run] = useActionState(async () => {
    const r = await setAutoRemindersAction(!enabled);
    if (r.ok) router.refresh();
    return r;
  }, initialActionState);
  return (
    <div className="space-y-2">
      <Button type="button" variant={enabled ? "outline" : "default"} disabled={disabled || pending} onClick={() => start(() => run())}>
        <MessageCircleIcon aria-hidden />
        {enabled ? t("turnOff") : t("turnOn")}
      </Button>
      {state.error ? <p role="alert" className="text-sm text-destructive">{errorText(state.error)}</p> : null}
    </div>
  );
}

/** Sends the reminder template with sample values to a number, to check the WhatsApp setup. */
export function TestReminderForm() {
  const t = useTranslations("reminders");
  const [state, action] = useActionState(sendTestReminderAction, initialActionState);
  const detail = state.data as { code?: string; title?: string } | undefined;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <TextField label={t("test.phone")} name="phone" type="tel" inputMode="tel" dir="ltr" defaultValue={state.values?.phone} error={state.fieldErrors?.phone} fieldClassName="w-56" />
      <SubmitButton variant="outline">
        <SendIcon aria-hidden />
        {t("test.send")}
      </SubmitButton>
      <div className="basis-full">
        <FormError error={state.error} />
        {detail?.code ? <p className="text-xs text-muted-foreground" dir="ltr">{detail.code} · {detail.title}</p> : null}
        {state.ok ? <p role="status" className="text-sm text-primary">{t("test.sent")}</p> : null}
      </div>
    </form>
  );
}
