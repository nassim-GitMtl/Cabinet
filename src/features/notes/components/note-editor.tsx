"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2Icon, Loader2Icon, PenLineIcon, SendIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { FormError, SubmitButton, TextAreaField, TextField, useErrorText } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { NoteBody } from "@/server/db/schema";
import { amendNoteAction, discardDraftAction, saveDraftAction, signNoteAction, submitForReviewAction } from "../actions";

const SECTIONS = ["chiefComplaint", "observations", "assessment", "plan", "performedWork"] as const;
type SaveState = "saved" | "saving" | "dirty" | "conflict" | "error";

/** Draft editor with debounced autosave and optimistic locking. */
export function NoteEditor({
  noteId,
  patientId,
  initialBody,
  initialVersion,
  status,
  canSign,
}: {
  noteId: string;
  patientId: string;
  initialBody: NoteBody;
  initialVersion: number;
  status: "draft" | "in_review";
  canSign: boolean;
}) {
  const t = useTranslations("notes");
  const errorText = useErrorText();
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [teeth, setTeeth] = useState(initialBody.teeth.join(" "));
  const [save, setSave] = useState<SaveState>("saved");
  const [attested, setAttested] = useState(false);
  const [pending, start] = useTransition();
  const version = useRef(initialVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ body, teeth });
  useEffect(() => {
    latest.current = { body, teeth };
  }, [body, teeth]);

  const flush = async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    setSave("saving");
    const payload = { ...latest.current.body, teeth: latest.current.teeth.split(/[\s,;]+/).filter(Boolean) };
    const r = await saveDraftAction(noteId, payload, version.current);
    if (r.ok) {
      version.current = (r.data as { version: number }).version;
      setSave("saved");
      return true;
    }
    setSave(r.error?.endsWith("conflict") ? "conflict" : "error");
    return false;
  };

  const schedule = () => {
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
  };

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save === "dirty" || save === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  const run = (task: () => Promise<ActionState>, ok?: string) =>
    start(async () => {
      if (save !== "saved" && !(await flush())) return;
      const r = await task();
      if (r?.error) toast.error(errorText(r.error));
      else {
        if (ok) toast.success(ok);
        router.refresh();
      }
    });

  const indicator = {
    saved: <span className="inline-flex items-center gap-1 text-success"><CheckCircle2Icon className="size-3.5" aria-hidden />{t("autosaved")}</span>,
    saving: <span className="inline-flex items-center gap-1"><Loader2Icon className="size-3.5 animate-spin" aria-hidden />{t("saving")}</span>,
    dirty: <span>{t("unsaved")}</span>,
    conflict: <span className="inline-flex items-center gap-1 text-destructive"><TriangleAlertIcon className="size-3.5" aria-hidden />{t("conflict")}</span>,
    error: <span className="text-destructive">{t("saveError")}</span>,
  }[save];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground" aria-live="polite">{indicator}</p>
      {SECTIONS.map((k) => (
        <div key={k} className="grid gap-1.5">
          <Label htmlFor={`note-${k}`}>{t(`sections.${k}`)}</Label>
          <Textarea
            id={`note-${k}`}
            dir="auto"
            rows={k === "performedWork" || k === "observations" ? 4 : 3}
            value={body[k]}
            disabled={save === "conflict"}
            onChange={(e) => {
              setBody((b) => ({ ...b, [k]: e.target.value }));
              schedule();
            }}
          />
        </div>
      ))}
      <div className="grid gap-1.5">
        <Label htmlFor="note-teeth">{t("teeth")}</Label>
        <input
          id="note-teeth"
          className="h-11 rounded-lg border bg-transparent px-3 md:h-9"
          inputMode="numeric"
          dir="ltr"
          value={teeth}
          placeholder="36 37"
          disabled={save === "conflict"}
          onChange={(e) => {
            setTeeth(e.target.value);
            schedule();
          }}
        />
        <p className="text-xs text-muted-foreground">{t("teethHint")}</p>
      </div>

      {save === "conflict" ? (
        <Button variant="outline" onClick={() => router.refresh()}>{t("reload")}</Button>
      ) : (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          {canSign ? (
            <>
              <div className="flex items-start gap-3">
                <Checkbox id="attest" checked={attested} onCheckedChange={(v) => setAttested(Boolean(v))} />
                <Label htmlFor="attest" className="text-sm leading-snug font-normal">{t("attestation")}</Label>
              </div>
              <Button disabled={!attested || pending} onClick={() => run(() => signNoteAction(noteId, patientId, version.current, attested), t("signed"))}>
                <PenLineIcon aria-hidden />
                {t("sign")}
              </Button>
            </>
          ) : status === "draft" ? (
            <Button disabled={pending} onClick={() => run(() => submitForReviewAction(noteId, patientId), t("submitted"))}>
              <SendIcon aria-hidden />
              {t("submitForReview")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("awaitingSignature")}</p>
          )}
          <Button variant="ghost" disabled={pending} onClick={() => start(async () => { await discardDraftAction(noteId); })}>
            <Trash2Icon aria-hidden />
            {t("discard")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function AmendForm({ noteId, patientId, current }: { noteId: string; patientId: string; current: NoteBody }) {
  const t = useTranslations("notes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (p: ActionState, fd: FormData) => {
    const r = await amendNoteAction(noteId, patientId, p, fd);
    if (r.ok) {
      setOpen(false);
      toast.success(t("amended"));
      router.refresh();
    }
    return r;
  }, initialActionState);
  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PenLineIcon aria-hidden />
        {t("amend")}
      </Button>
    );
  }
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-3 rounded-xl border p-4" noValidate>
      <p className="text-sm text-muted-foreground">{t("amendHint")}</p>
      <FormError error={state.error} />
      <TextField label={t("amendReason")} name="reason" required defaultValue={v.reason} />
      {SECTIONS.map((k) => (
        <TextAreaField key={k} label={t(`sections.${k}`)} name={k} rows={2} dir="auto" defaultValue={v[k] ?? current[k]} />
      ))}
      <TextField label={t("teeth")} name="teeth" dir="ltr" defaultValue={v.teeth ?? current.teeth.join(" ")} />
      <div className="flex gap-2">
        <SubmitButton>{t("signAmendment")}</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
    </form>
  );
}
