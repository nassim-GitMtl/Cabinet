"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellPlusIcon, CheckCheckIcon, CheckIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { FormError, SubmitButton, useErrorText } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import type { Answers, Question } from "@/server/db/schema";
import { approveQuestionnaireAction, promoteToAlertAction, recordResponseAction, reviewAction } from "../actions";

const VALUES = ["yes", "no", "unknown", "declined"] as const;

function useRun() {
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (task: () => Promise<ActionState>, ok?: string) =>
      start(async () => {
        const r = await task();
        if (r.error) toast.error(errorText(r.error));
        else {
          if (ok) toast.success(ok);
          router.refresh();
        }
      }),
  };
}

export function ReviewButtons({ patientId, latestReviewed, hasResponse }: { patientId: string; latestReviewed: boolean; hasResponse: boolean }) {
  const t = useTranslations("health");
  const { pending, run } = useRun();
  if (!hasResponse) return null;
  return (
    <>
      {!latestReviewed ? (
        <Button disabled={pending} onClick={() => run(() => reviewAction(patientId, "reviewed"), t("reviewedToast"))}>
          <CheckIcon aria-hidden />
          {t("markReviewed")}
        </Button>
      ) : null}
      <Button variant="outline" disabled={pending} onClick={() => run(() => reviewAction(patientId, "no_changes"), t("reviewedToast"))}>
        <CheckCheckIcon aria-hidden />
        {t("noChanges")}
      </Button>
    </>
  );
}

export function ApproveButton({ patientId }: { patientId: string }) {
  const t = useTranslations("health");
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => approveQuestionnaireAction(patientId), t("approvedToast"))}>
      <ShieldCheckIcon aria-hidden />
      {t("approve")}
    </Button>
  );
}

export function PromoteButton({ patientId, questionId }: { patientId: string; questionId: string }) {
  const t = useTranslations("health");
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => promoteToAlertAction(patientId, questionId), t("alertCreated"))}>
      <BellPlusIcon aria-hidden />
      {t("createAlert")}
    </Button>
  );
}

/** Questionnaire form, prefilled with the previous answers (a new response is recorded; history is kept). */
export function QuestionnaireForm({ patientId, questions, previous, locale }: { patientId: string; questions: Question[]; previous: Answers; locale: string }) {
  const t = useTranslations("health");
  const [state, action] = useActionState(recordResponseAction.bind(null, patientId), initialActionState);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(previous).map(([k, v]) => [k, v.value ?? ""])));
  const label = (l: Question["label"]) => (l as Record<string, string | undefined>)[locale] || l.fr;
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <p className="text-sm text-muted-foreground">{t("formHint")}</p>
      <ol className="space-y-3">
        {questions.map((q, i) => (
          <li key={q.id} className="rounded-xl border bg-card p-4">
            <fieldset>
              <legend className="mb-2 font-medium">
                {i + 1}. {label(q.label)}
                {q.sensitive ? <span className="ms-2 text-xs font-normal text-muted-foreground">({t("sensitive")})</span> : null}
              </legend>
              {q.kind === "yes_no" ? (
                <>
                  <div className="flex flex-wrap gap-2" role="radiogroup">
                    {VALUES.map((v) => (
                      <label
                        key={v}
                        className={cn(
                          "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm",
                          values[q.id] === v ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted",
                        )}
                      >
                        <input type="radio" name={`q_${q.id}`} value={v} checked={values[q.id] === v} onChange={() => setValues((s) => ({ ...s, [q.id]: v }))} className="accent-[var(--primary)]" />
                        {t(`values.${v}`)}
                      </label>
                    ))}
                    {values[q.id] ? (
                      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setValues((s) => ({ ...s, [q.id]: "" }))}>
                        {t("clear")}
                      </button>
                    ) : null}
                  </div>
                  {values[q.id] === "yes" && q.detailPrompt ? (
                    <Textarea name={`d_${q.id}`} rows={2} dir="auto" className="mt-2" placeholder={label(q.detailPrompt)} aria-label={label(q.detailPrompt)} defaultValue={previous[q.id]?.details ?? ""} />
                  ) : null}
                </>
              ) : (
                <Textarea name={`t_${q.id}`} rows={3} dir="auto" defaultValue={previous[q.id]?.text ?? ""} aria-label={label(q.label)} />
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Checkbox id="acknowledged" name="acknowledged" />
        <Label htmlFor="acknowledged" className="text-sm leading-snug font-normal">{t("acknowledged")}</Label>
      </div>
      <SubmitButton size="lg">{t("save")}</SubmitButton>
    </form>
  );
}
