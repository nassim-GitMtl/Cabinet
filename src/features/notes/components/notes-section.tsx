"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { FilePenLineIcon, PlusIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initialActionState } from "@/lib/action-state";
import { formatDateOnly } from "@/lib/dates";
import { createNoteAction } from "../actions";

type NoteRow = { id: string; kind: string; status: string; serviceDate: string; currentVersion: number; providerName: string; providerTitle: string | null };

export function NotesSection({
  patientId,
  notes,
  canWrite,
  templates,
  providers,
  today,
}: {
  patientId: string;
  notes: NoteRow[];
  canWrite: boolean;
  templates: { value: string; label: string; kind: string }[];
  providers: { value: string; label: string }[];
  today: string;
}) {
  const t = useTranslations("notes");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createNoteAction.bind(null, patientId), initialActionState);
  return (
    <section className="rounded-xl border bg-card p-4" aria-labelledby="notes-title">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="notes-title" className="flex items-center gap-2 font-semibold">
          <FilePenLineIcon className="size-4 text-primary" aria-hidden />
          {t("title")}
        </h2>
        {canWrite ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            <PlusIcon aria-hidden />
            {t("new")}
          </Button>
        ) : null}
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {notes.map((n) => (
            <li key={n.id}>
              <Link href={`/patients/${patientId}/notes/${n.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-accent/40">
                <span>
                  <span className="font-medium">{t(`kinds.${n.kind as "progress"}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateOnly(n.serviceDate)} · <bdi>{[n.providerTitle, n.providerName].filter(Boolean).join(" ")}</bdi>
                  </span>
                </span>
                <span className="flex gap-1.5">
                  {n.currentVersion > 1 ? <Badge variant="secondary">{t("amendedBadge", { count: n.currentVersion - 1 })}</Badge> : null}
                  <Badge variant={n.status === "signed" ? "default" : "outline"}>{t(`status.${n.status as "draft"}`)}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
            <DialogDescription>{t("newHint")}</DialogDescription>
          </DialogHeader>
          <form
            action={action}
            className="space-y-4"
            noValidate
            onChange={(e) => {
              // Picking a template also picks its note type (still editable).
              const target = e.target as unknown as HTMLSelectElement;
              if (target.name !== "templateId") return;
              const tpl = templates.find((x) => x.value === target.value);
              const kind = e.currentTarget.elements.namedItem("kind") as HTMLSelectElement | null;
              if (tpl && kind) kind.value = tpl.kind;
            }}
          >
            <FormError error={state.error} />
            <SelectField label={t("template")} name="templateId" defaultValue="" placeholder={t("noTemplate")} options={templates.map((x) => ({ value: x.value, label: x.label }))} />
            <SelectField label={t("kind")} name="kind" defaultValue={state.values?.kind ?? "progress"} options={(["consultation", "progress", "procedure", "post_op", "referral", "other"] as const).map((k) => ({ value: k, label: t(`kinds.${k}`) }))} />
            <TextField label={t("serviceDate")} name="serviceDate" type="date" max={today} defaultValue={state.values?.serviceDate ?? today} error={state.fieldErrors?.serviceDate} />
            <SelectField label={t("provider")} name="providerId" defaultValue={state.values?.providerId ?? providers[0]?.value} options={providers} />
            <SubmitButton className="w-full">{t("create")}</SubmitButton>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
