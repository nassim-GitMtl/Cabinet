"use client";

import { useActionState, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { initialActionState } from "@/lib/action-state";
import type { LocalizedText } from "@/server/db/schema/_shared";
import type { Question } from "@/server/db/schema";
import { createQuestionnaireDraftAction, publishQuestionnaireVersionAction } from "../actions";

type DraftQuestion = {
  key: number; id: string; kind: "yes_no" | "text"; labelFr: string; labelEn: string; labelAr: string;
  detailFr: string; detailEn: string; detailAr: string; sensitive: boolean;
  alertLabelFr: string; alertLabelEn: string; alertLabelAr: string; alertKind: "" | "medical" | "allergy" | "medication";
};

const local = (value: LocalizedText | undefined, locale: "fr" | "en" | "ar") => value?.[locale] ?? "";
const fromQuestion = (question: Question, key: number): DraftQuestion => ({
  key, id: question.id, kind: question.kind, labelFr: local(question.label, "fr"), labelEn: local(question.label, "en"), labelAr: local(question.label, "ar"),
  detailFr: local(question.detailPrompt, "fr"), detailEn: local(question.detailPrompt, "en"), detailAr: local(question.detailPrompt, "ar"), sensitive: !!question.sensitive,
  alertLabelFr: local(question.alertLabel, "fr"), alertLabelEn: local(question.alertLabel, "en"), alertLabelAr: local(question.alertLabel, "ar"), alertKind: question.alertKind ?? "",
});
const emptyQuestion = (key: number): DraftQuestion => ({ key, id: `question_${key}`, kind: "yes_no", labelFr: "", labelEn: "", labelAr: "", detailFr: "", detailEn: "", detailAr: "", sensitive: false, alertLabelFr: "", alertLabelEn: "", alertLabelAr: "", alertKind: "" });

export function QuestionnaireEditor({ title, questions }: { title: LocalizedText; questions: Question[] }) {
  const t = useTranslations("health.editor"); const [state, action] = useActionState(createQuestionnaireDraftAction, initialActionState);
  const [rows, setRows] = useState(() => questions.map((question, index) => fromQuestion(question, index + 1)));
  const update = (key: number, patch: Partial<DraftQuestion>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  const move = (index: number, offset: number) => setRows((current) => { const next = [...current]; const target = index + offset; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target]!, next[index]!]; return next; });
  const payload = rows.map((question) => ({ id: question.id, kind: question.kind, labelFr: question.labelFr, labelEn: question.labelEn, labelAr: question.labelAr, detailFr: question.detailFr, detailEn: question.detailEn, detailAr: question.detailAr, sensitive: question.sensitive, alertLabelFr: question.alertLabelFr, alertLabelEn: question.alertLabelEn, alertLabelAr: question.alertLabelAr, alertKind: question.alertKind || null }));
  return <form action={action} className="space-y-5"><FormError error={state.error} />
    {state.ok ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">{t("draftSaved")}</p> : null}
    <section className="rounded-2xl border bg-card p-4 shadow-sm"><h2 className="mb-3 font-semibold">{t("titleSection")}</h2><div className="grid gap-3 md:grid-cols-3">
      <TextField name="titleFr" label={t("titleFr")} required defaultValue={title.fr} />
      <TextField name="titleEn" label={t("titleEn")} defaultValue={title.en ?? ""} optionalLabel />
      <TextField name="titleAr" label={t("titleAr")} defaultValue={title.ar ?? ""} optionalLabel dir="rtl" />
    </div></section>
    <input type="hidden" name="questions" value={JSON.stringify(payload)} />
    <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{t("questions")}</h2><p className="text-sm text-muted-foreground">{t("questionsHint")}</p></div><Button type="button" variant="outline" onClick={() => setRows((current) => [...current, emptyQuestion(Math.max(0, ...current.map((row) => row.key)) + 1)])}><PlusIcon />{t("addQuestion")}</Button></div>
      {rows.map((row, index) => <article key={row.key} className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-semibold">{t("questionNumber", { number: index + 1 })}</h3><div className="flex gap-1"><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("moveUp")}><ArrowUpIcon /></Button><Button type="button" variant="ghost" size="icon" disabled={index === rows.length - 1} onClick={() => move(index, 1)} aria-label={t("moveDown")}><ArrowDownIcon /></Button><Button type="button" variant="destructive" size="icon" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} aria-label={t("removeQuestion")}><Trash2Icon /></Button></div></div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-1.5"><Label>{t("id")}</Label><Input value={row.id} onChange={(event) => update(row.key, { id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} dir="ltr" required /></div>
          <div className="grid gap-1.5"><Label>{t("kind")}</Label><NativeSelect value={row.kind} onChange={(event) => update(row.key, { kind: event.target.value as DraftQuestion["kind"], ...(event.target.value === "text" ? { detailFr: "", detailEn: "", detailAr: "" } : {}) })}><NativeSelectOption value="yes_no">{t("yesNo")}</NativeSelectOption><NativeSelectOption value="text">{t("freeText")}</NativeSelectOption></NativeSelect></div>
          <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={row.sensitive} onCheckedChange={(checked) => update(row.key, { sensitive: checked === true })} />{t("sensitive")}</label></div>
          <EditorInput label={t("labelFr")} value={row.labelFr} onChange={(value) => update(row.key, { labelFr: value })} required />
          <EditorInput label={t("labelEn")} value={row.labelEn} onChange={(value) => update(row.key, { labelEn: value })} />
          <EditorInput label={t("labelAr")} value={row.labelAr} onChange={(value) => update(row.key, { labelAr: value })} dir="rtl" />
          {row.kind === "yes_no" ? <><EditorInput label={t("detailFr")} value={row.detailFr} onChange={(value) => update(row.key, { detailFr: value })} /><EditorInput label={t("detailEn")} value={row.detailEn} onChange={(value) => update(row.key, { detailEn: value })} /><EditorInput label={t("detailAr")} value={row.detailAr} onChange={(value) => update(row.key, { detailAr: value })} dir="rtl" /></> : null}
        </div>
        <details className="mt-4 rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">{t("alertOptions")}</summary><div className="mt-3 grid gap-3 md:grid-cols-4"><div className="grid gap-1.5"><Label>{t("alertKind")}</Label><NativeSelect value={row.alertKind} onChange={(event) => update(row.key, { alertKind: event.target.value as DraftQuestion["alertKind"] })}><NativeSelectOption value="">{t("noAlert")}</NativeSelectOption><NativeSelectOption value="medical">{t("alertMedical")}</NativeSelectOption><NativeSelectOption value="allergy">{t("alertAllergy")}</NativeSelectOption><NativeSelectOption value="medication">{t("alertMedication")}</NativeSelectOption></NativeSelect></div><EditorInput label={t("alertLabelFr")} value={row.alertLabelFr} onChange={(value) => update(row.key, { alertLabelFr: value })} /><EditorInput label={t("alertLabelEn")} value={row.alertLabelEn} onChange={(value) => update(row.key, { alertLabelEn: value })} /><EditorInput label={t("alertLabelAr")} value={row.alertLabelAr} onChange={(value) => update(row.key, { alertLabelAr: value })} dir="rtl" /></div></details>
      </article>)}
    </section>
    <div className="sticky bottom-20 z-10 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur lg:bottom-4"><SubmitButton size="lg">{t("saveDraft")}</SubmitButton><p className="mt-1 text-xs text-muted-foreground">{t("saveHint")}</p></div>
  </form>;
}

function EditorInput({ label, value, onChange, required, dir }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; dir?: "rtl" }) {
  return <div className="grid gap-1.5"><Label>{label}{required ? <span className="text-destructive"> *</span> : null}</Label><Input value={value} onChange={(event) => onChange(event.target.value)} required={required} dir={dir ?? "auto"} /></div>;
}

export function PublishQuestionnaireButton({ versionId }: { versionId: string }) {
  const t = useTranslations("health.editor"); const [state, action] = useActionState(publishQuestionnaireVersionAction, initialActionState);
  return <form action={action} className="grid gap-2"><input type="hidden" name="versionId" value={versionId} /><FormError error={state.error} /><SubmitButton size="sm">{t("approveAndActivate")}</SubmitButton></form>;
}
