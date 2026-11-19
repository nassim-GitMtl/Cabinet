"use client";

import { useActionState, useState } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton } from "@/components/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { initialActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import type { Answers, Question } from "@/server/db/schema";
import { recordPortalResponseAction, recordTabletResponseAction } from "../actions";

const VALUES = ["yes", "no", "unknown", "declined"] as const;

export function PatientQuestionnaireForm({ mode, reference, questions, previous, locale }: { mode: "portal" | "tablet"; reference: string; questions: Question[]; previous: Answers; locale: string }) {
  const t = useTranslations("health");
  const serverAction = mode === "portal" ? recordPortalResponseAction.bind(null, reference) : recordTabletResponseAction.bind(null, reference);
  const [state, action] = useActionState(serverAction, initialActionState);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, value.value ?? ""])));
  const label = (value: Question["label"]) => (value as Record<string, string | undefined>)[locale] || value.fr;
  if (state.ok) return <div role="status" className="rounded-2xl border border-success/30 bg-success/10 p-8 text-center"><CheckCircle2Icon className="mx-auto mb-3 size-10 text-success" /><h2 className="text-xl font-semibold">{t("patient.savedTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t(mode === "tablet" ? "patient.savedTablet" : "patient.savedPortal")}</p></div>;
  return <form action={action} className="space-y-4" noValidate><FormError error={state.error} /><p className="text-sm text-muted-foreground">{t("patient.formHint")}</p><ol className="space-y-3">{questions.map((question, index) => <li key={question.id} className="rounded-xl border bg-card p-4"><fieldset><legend className="mb-2 font-medium">{index + 1}. {label(question.label)}{question.sensitive ? <span className="ms-2 text-xs font-normal text-muted-foreground">({t("sensitive")})</span> : null}</legend>
    {question.kind === "yes_no" ? <><div className="flex flex-wrap gap-2">{VALUES.map((value) => <label key={value} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm", values[question.id] === value ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted")}><input type="radio" name={`q_${question.id}`} value={value} checked={values[question.id] === value} onChange={() => setValues((current) => ({ ...current, [question.id]: value }))} className="accent-[var(--primary)]" />{t(`values.${value}`)}</label>)}</div>{values[question.id] === "yes" && question.detailPrompt ? <Textarea name={`d_${question.id}`} rows={2} dir="auto" className="mt-2" placeholder={label(question.detailPrompt)} aria-label={label(question.detailPrompt)} defaultValue={previous[question.id]?.details ?? ""} /> : null}</> : <Textarea name={`t_${question.id}`} rows={3} dir="auto" defaultValue={previous[question.id]?.text ?? ""} aria-label={label(question.label)} />}
  </fieldset></li>)}</ol><div className="flex items-start gap-3 rounded-xl border bg-card p-4"><Checkbox id="patient-acknowledged" name="acknowledged" /><Label htmlFor="patient-acknowledged" className="text-sm leading-snug font-normal">{t("patient.acknowledged")}</Label></div><SubmitButton size="lg" className="w-full sm:w-auto">{t("patient.submit")}</SubmitButton></form>;
}
