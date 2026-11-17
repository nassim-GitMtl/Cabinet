"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, PlusIcon, ShieldAlertIcon, TriangleAlertIcon, InfoIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import { addAlertAction, resolveAlertAction } from "../actions";

type Alert = { id: string; kind: string; severity: "info" | "warning" | "critical"; label: string; details: string | null };

const SEVERITY_STYLE = {
  critical: { icon: ShieldAlertIcon, cls: "border-destructive/40 bg-destructive/5 text-destructive" },
  warning: { icon: TriangleAlertIcon, cls: "border-warning/50 bg-warning/10 text-warning-foreground" },
  info: { icon: InfoIcon, cls: "border-border bg-muted text-foreground" },
} as const;

export function AlertsPanel({ patientId, alerts, canManage }: { patientId: string; alerts: Alert[]; canManage: boolean }) {
  const t = useTranslations("patients");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await addAlertAction(patientId, prev, formData);
    if (result.ok) setOpen(false);
    return result;
  }, initialActionState);
  const [pending, startTransition] = useTransition();

  return (
    <section aria-labelledby="alerts-title" className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="alerts-title" className="text-sm font-semibold">
          {t("alerts")}
        </h2>
        {canManage ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <PlusIcon aria-hidden />
            {t("addAlert")}
          </Button>
        ) : null}
      </div>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noAlerts")}</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => {
            const style = SEVERITY_STYLE[a.severity];
            return (
              <li key={a.id} className={cn("flex items-start gap-2 rounded-lg border p-2.5 text-sm", style.cls)}>
                <style.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <span className="sr-only">{t(`severity.${a.severity}`)} — </span>
                    {a.label}
                  </p>
                  <p className="text-xs opacity-80">
                    {t(`alertKind.${a.kind}` as never)} · {t(`severity.${a.severity}`)}
                  </p>
                  {a.details ? <p className="mt-1 text-xs whitespace-pre-line text-foreground/80">{a.details}</p> : null}
                </div>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    aria-label={t("resolveAlert")}
                    title={t("resolveAlert")}
                    onClick={() => startTransition(() => resolveAlertAction(a.id))}
                  >
                    <CheckIcon aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addAlert")}</DialogTitle>
            <DialogDescription className="sr-only">{t("alerts")}</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4" noValidate>
            <FormError error={state.error} />
            <TextField label={t("alertLabel")} name="label" required defaultValue={state.values?.label} error={state.fieldErrors?.label} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t("alertKindLabel")}
                name="kind"
                defaultValue={state.values?.kind ?? "medical"}
                options={(["medical", "allergy", "medication", "administrative"] as const).map((k) => ({ value: k, label: t(`alertKind.${k}`) }))}
              />
              <SelectField
                label={t("severityLabel")}
                name="severity"
                defaultValue={state.values?.severity ?? "warning"}
                options={(["info", "warning", "critical"] as const).map((s) => ({ value: s, label: t(`severity.${s}`) }))}
              />
            </div>
            <TextAreaField label={t("alertDetails")} name="details" optionalLabel rows={3} defaultValue={state.values?.details} />
            <SubmitButton className="w-full">{t("addAlert")}</SubmitButton>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
