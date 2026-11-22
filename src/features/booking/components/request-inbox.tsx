"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, PencilIcon, PhoneIcon, SearchIcon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { FormError, SelectField, SubmitButton, TextField, useErrorText } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { searchAgendaPatientsAction } from "@/features/agenda/actions";
import { approveRequestAction, createLinkAction, createPatientFromRequestAction, declineRequestAction, toggleLinkAction, updateRequestAction } from "../actions";

export type InboxItem = {
  id: string;
  contactName: string;
  contactPhone: string;
  phoneDisplay: string;
  contactEmail: string | null;
  declaresExistingPatient: boolean;
  typeName: string;
  providerName: string;
  when: string;
  waiting: string;
  message: string | null;
  /** Translated answer to "how did you hear of us", when given. */
  channel: string | null;
  appointmentTypeId: string;
  providerId: string;
  date: string;
  time: string;
  durationMin: number;
  version: number;
};

type EditOptions = { types: { value: string; label: string }[]; providers: { value: string; label: string }[] };

type Candidate = { id: string; patientNumber: string; firstName: string; lastName: string; phone: string | null };

export function RequestCard({ item, canApprove, editOptions }: { item: InboxItem; canApprove: boolean; editOptions: EditOptions }) {
  const t = useTranslations("booking");
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const approve = (patientId: string) =>
    start(async () => {
      const r = await approveRequestAction(item.id, patientId);
      if (r.error) toast.error(errorText(r.error));
      else {
        toast.success(t("approved"));
        router.refresh();
      }
    });
  const createAndApprove = (force: boolean) =>
    start(async () => {
      const r = await createPatientFromRequestAction(item.id, force);
      if (r.error) return void toast.error(errorText(r.error));
      const data = r.data as { patientId?: string; duplicates?: Candidate[] };
      if (data.duplicates) return void setCandidates(data.duplicates);
      const a = await approveRequestAction(item.id, data.patientId!);
      if (a.error) toast.error(errorText(a.error));
      else {
        toast.success(t("approved"));
        router.refresh();
      }
    });

  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold"><bdi>{item.contactName}</bdi></p>
          <p className="text-sm">
            {item.typeName} · <span className="font-medium">{item.when}</span> · <bdi>{item.providerName}</bdi>
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <a href={`tel:${item.contactPhone}`} className="inline-flex items-center gap-1 hover:underline" dir="ltr">
              <PhoneIcon className="size-3" aria-hidden />
              {item.phoneDisplay}
            </a>
            {item.contactEmail ? <span>{item.contactEmail}</span> : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="outline">{t("waitingFor", { time: item.waiting })}</Badge>
          {item.declaresExistingPatient ? <Badge variant="secondary">{t("declaresExisting")}</Badge> : null}
          {item.channel ? <Badge variant="outline">{item.channel}</Badge> : null}
        </div>
      </div>
      {item.message ? <p className="mt-2 rounded-md bg-muted p-2 text-sm whitespace-pre-line" dir="auto">{item.message}</p> : null}

      {candidates ? (
        <div className="mt-3 space-y-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
          <p className="font-medium">{t("possibleMatches")}</p>
          {candidates.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span><bdi>{c.lastName} {c.firstName}</bdi> · {c.patientNumber}</span>
              <Button size="sm" disabled={pending} onClick={() => approve(c.id)}>{t("approveFor")}</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={pending} onClick={() => createAndApprove(true)}>{t("createAnyway")}</Button>
        </div>
      ) : null}

      {canApprove ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          <Button disabled={pending} onClick={() => createAndApprove(false)}>
            <UserPlusIcon aria-hidden />
            {t("createAndApprove")}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => setSearchOpen(true)}>
            <SearchIcon aria-hidden />
            {t("existingPatient")}
          </Button>
          <EditRequestButton item={item} options={editOptions} />
          <DeclineButton id={item.id} />
        </div>
      ) : null}
      <PatientPicker open={searchOpen} onOpenChange={setSearchOpen} onPick={(id) => { setSearchOpen(false); approve(id); }} />
    </li>
  );
}

function EditRequestButton({ item, options }: { item: InboxItem; options: EditOptions }) {
  const t = useTranslations("booking");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await updateRequestAction(item.id, item.version, previous, formData);
    if (result.ok) {
      setOpen(false);
      toast.success(t("updated"));
      router.refresh();
    }
    return result;
  }, initialActionState);
  return <>
    <Button variant="outline" disabled={options.types.length === 0 || options.providers.length === 0} onClick={() => setOpen(true)}>
      <PencilIcon aria-hidden />{t("editRequest")}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editRequest")}</DialogTitle>
          <DialogDescription>{t("editRequestHint")}</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormError error={state.error} />
          <SelectField label={t("appointmentType")} name="appointmentTypeId" options={options.types} required defaultValue={state.values?.appointmentTypeId ?? item.appointmentTypeId} error={state.fieldErrors?.appointmentTypeId} fieldClassName="sm:col-span-2" />
          <SelectField label={t("provider")} name="providerId" options={options.providers} required defaultValue={state.values?.providerId ?? item.providerId} error={state.fieldErrors?.providerId} fieldClassName="sm:col-span-2" />
          <TextField label={t("date")} name="date" type="date" required defaultValue={state.values?.date ?? item.date} error={state.fieldErrors?.date} />
          <TextField label={t("time")} name="time" type="time" required defaultValue={state.values?.time ?? item.time} error={state.fieldErrors?.time} />
          <TextField label={t("duration")} name="durationMin" type="number" min={5} max={480} step={5} required defaultValue={state.values?.durationMin ?? String(item.durationMin)} error={state.fieldErrors?.durationMin} />
          <SubmitButton className="self-end sm:col-span-2">{t("saveChanges")}</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

function PatientPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (id: string) => void }) {
  const t = useTranslations("booking");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Candidate[]>([]);
  const [, start] = useTransition();
  useEffect(() => {
    if (q.trim().length < 2) return;
    const timer = window.setTimeout(() => start(async () => setRows(await searchAgendaPatientsAction(q))), 250);
    return () => window.clearTimeout(timer);
  }, [q]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("existingPatient")}</DialogTitle>
          <DialogDescription>{t("existingPatientHint")}</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPatient")} aria-label={t("searchPatient")} />
        <ul className="max-h-64 divide-y overflow-y-auto">
          {q.trim().length >= 2
            ? rows.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(p.id)} className="flex w-full items-center justify-between gap-2 p-2 text-start hover:bg-accent">
                    <bdi>{p.lastName} {p.firstName}</bdi>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">{p.patientNumber}<CheckIcon className="size-4" aria-hidden /></span>
                  </button>
                </li>
              ))
            : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function DeclineButton({ id }: { id: string }) {
  const t = useTranslations("booking");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (p: ActionState, fd: FormData) => {
    const r = await declineRequestAction(id, p, fd);
    if (r.ok) {
      setOpen(false);
      router.refresh();
    }
    return r;
  }, initialActionState);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>{t("decline")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("decline")}</DialogTitle>
            <DialogDescription>{t("declineHint")}</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4" noValidate>
            <FormError error={state.error} />
            <TextField label={t("declineReason")} name="reason" required defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
            <SubmitButton variant="destructive" className="w-full">{t("decline")}</SubmitButton>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LinkRow({ id, url, label, active }: { id: string; url: string; label: string; active: boolean }) {
  const t = useTranslations("booking");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground" dir="ltr">{url}</span>
      </span>
      <span className="flex gap-2">
        {active ? (
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success(t("copied")))}>
            <CopyIcon aria-hidden />
            {t("copy")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await toggleLinkAction(id, !active); router.refresh(); })}>
          {active ? t("deactivate") : t("activate")}
        </Button>
      </span>
    </li>
  );
}

export function NewLinkForm() {
  const t = useTranslations("booking");
  const router = useRouter();
  const [state, action] = useActionState(async (p: ActionState, fd: FormData) => {
    const r = await createLinkAction(p, fd);
    if (r.ok) router.refresh();
    return r;
  }, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <FormError error={state.error} />
      <TextField label={t("linkLabel")} name="label" fieldClassName="min-w-48 flex-1" placeholder={t("linkLabelPlaceholder")} />
      <SubmitButton>{t("createLink")}</SubmitButton>
    </form>
  );
}
