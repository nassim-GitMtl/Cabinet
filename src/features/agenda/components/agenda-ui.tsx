"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPhone } from "@/lib/phone";
import { useTranslations } from "next-intl";
import { CalendarPlusIcon, Clock3Icon, FileTextIcon, Loader2Icon, MoveIcon, PlusIcon, SearchIcon, UserRoundIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { toast } from "sonner";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField, useErrorText } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialActionState, type ActionState } from "@/lib/action-state";
import {
  cancelAppointmentAction,
  confirmationAction,
  createAppointmentAction,
  rescheduleAppointmentAction,
  searchAgendaPatientsAction,
  visitStatusAction,
} from "../actions";

export type Setup = {
  providers: Array<{ value: string; label: string }>;
  chairs: Array<{ value: string; label: string }>;
  types: Array<{ value: string; label: string; durationMin: number }>;
};

type PatientResult = Awaited<ReturnType<typeof searchAgendaPatientsAction>>[number];

export type AppointmentViewItem = {
  id: string;
  patientId: string;
  patientName: string;
  patientNumber: string;
  phone: string | null;
  providerId: string;
  providerName: string;
  providerTitle: string | null;
  chairName: string | null;
  typeName: string | null;
  typeColor: string | null;
  startTime: string;
  endTime: string;
  schedulingStatus: "requested" | "booked" | "cancelled" | "no_show";
  confirmationStatus: "pending" | "confirmed" | "declined" | "reschedule_requested";
  visitStatus: "not_arrived" | "arrived" | "waiting" | "in_treatment" | "completed";
  notes: string | null;
  version: number;
  chairId: string | null;
  typeId: string | null;
  /** Clinic-local YYYY-MM-DD of the start. */
  date: string;
  durationMin: number;
};

/** Picking an appointment type fills in its default duration (still editable). */
function typeDurationSync(setup: Setup) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLSelectElement;
    if (target.name !== "appointmentTypeId") return;
    const type = setup.types.find((x) => x.value === target.value);
    const duration = event.currentTarget.elements.namedItem("durationMin") as HTMLInputElement | null;
    if (type && duration) duration.value = String(type.durationMin);
  };
}

/** `patient`: preselected when coming from a patient file ("Prendre rendez-vous"); the form then opens directly. */
export function NewAppointmentButton({ setup, date, patient = null }: { setup: Setup; date: string; patient?: PatientResult | null }) {
  const t = useTranslations("agenda");
  const router = useRouter();
  const [open, setOpen] = useState(patient !== null);
  const change = (next: boolean) => {
    setOpen(next);
    // Drop ?patient= once used, so a refresh does not reopen the form.
    if (!next && patient) router.replace(`/agenda?date=${date}`);
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CalendarPlusIcon aria-hidden />
        {t("new")}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
            <DialogDescription>{t("newHint")}</DialogDescription>
          </DialogHeader>
          {open ? <AppointmentForm setup={setup} date={date} initialPatient={patient} close={() => change(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AppointmentForm({ setup, date, close, initialPatient = null }: { setup: Setup; date: string; close: () => void; initialPatient?: PatientResult | null }) {
  const t = useTranslations("agenda");
  const router = useRouter();
  const [query, setQuery] = useState(initialPatient ? `${initialPatient.firstName} ${initialPatient.lastName}` : "");
  const [results, setResults] = useState<PatientResult[]>([]);
  const [selected, setSelected] = useState<PatientResult | null>(initialPatient);
  const [searching, startSearch] = useTransition();
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await createAppointmentAction(previous, formData);
    if (result.ok) {
      close();
      router.refresh();
      toast.success(t("created"));
    }
    return result;
  }, initialActionState);

  useEffect(() => {
    if (query.trim().length < 2 || selected) {
      return;
    }
    const timer = window.setTimeout(() => {
      startSearch(async () => setResults(await searchAgendaPatientsAction(query)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, selected]);

  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const firstType = setup.types[0];
  return (
    <form action={action} onChange={typeDurationSync(setup)} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <div className="grid gap-1.5">
        <Label htmlFor="appointment-patient-search">{t("patient")} <span className="text-destructive">*</span></Label>
        {selected ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
            <span className="min-w-0">
              <span className="block truncate font-medium"><bdi>{selected.firstName} {selected.lastName}</bdi></span>
              <span className="block text-xs text-muted-foreground"><bdi>{selected.patientNumber}</bdi></span>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setSelected(null); setQuery(""); setResults([]); }}>
              {t("changePatient")}
            </Button>
          </div>
        ) : (
          <div className="relative">
            <SearchIcon className="absolute start-3 top-3 size-4 text-muted-foreground" aria-hidden />
            <Input
              id="appointment-patient-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("patientSearch")}
              className="ps-9"
              autoComplete="off"
            />
            {query.trim().length >= 2 ? (
              <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                {searching ? <p className="p-3 text-sm text-muted-foreground">{t("searching")}</p> : results.length ? results.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md p-2 text-start hover:bg-accent"
                    onClick={() => { setSelected(patient); setQuery(`${patient.firstName} ${patient.lastName}`); }}
                  >
                    <span><bdi>{patient.firstName} {patient.lastName}</bdi></span>
                    <span className="text-xs text-muted-foreground"><bdi>{patient.patientNumber}</bdi></span>
                  </button>
                )) : <p className="p-3 text-sm text-muted-foreground">{t("noPatient")}</p>}
              </div>
            ) : null}
          </div>
        )}
        <input type="hidden" name="patientId" value={selected?.id ?? values.patientId ?? ""} />
        {errors.patientId ? <p className="text-xs font-medium text-destructive">{t("errors.patientUnavailable")}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t("date")} name="date" type="date" required defaultValue={values.date ?? date} error={errors.date} />
        <TextField label={t("time")} name="time" type="time" required defaultValue={values.time ?? "09:00"} error={errors.time} />
        <SelectField label={t("provider")} name="providerId" required defaultValue={values.providerId ?? setup.providers[0]?.value} options={setup.providers} error={errors.providerId} />
        <SelectField label={t("chair")} name="chairId" required defaultValue={values.chairId ?? setup.chairs[0]?.value} options={setup.chairs} error={errors.chairId} />
        <SelectField label={t("type")} name="appointmentTypeId" required defaultValue={values.appointmentTypeId ?? firstType?.value} options={setup.types} error={errors.appointmentTypeId} />
        <TextField label={t("duration")} name="durationMin" type="number" min={5} max={480} step={5} required defaultValue={values.durationMin ?? String(firstType?.durationMin ?? 30)} error={errors.durationMin} />
      </div>
      <TextAreaField label={t("notes")} name="notes" optionalLabel rows={2} defaultValue={values.notes} error={errors.notes} hint={t("notesHint")} />
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Checkbox id="outside-hours" name="outsideHoursOverride" defaultChecked={values.outsideHoursOverride === "on"} />
        <Label htmlFor="outside-hours" className="font-normal">
          {t("outsideHoursOverride")}
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("outsideHoursHint")}</span>
        </Label>
      </div>
      <SubmitButton className="w-full" disabled={!selected}>{t("book")}</SubmitButton>
    </form>
  );
}

const NEXT_VISIT: Record<AppointmentViewItem["visitStatus"], AppointmentViewItem["visitStatus"] | null> = {
  not_arrived: "arrived",
  arrived: "waiting",
  waiting: "in_treatment",
  in_treatment: "completed",
  completed: null,
};

export function AppointmentCard({ item, canManage, reception = false, setup }: { item: AppointmentViewItem; canManage: boolean; reception?: boolean; setup?: Setup }) {
  const t = useTranslations("agenda");
  const tr = useTranslations();
  const [moving, setMoving] = useState(false);
  const errorText = useErrorText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const next = NEXT_VISIT[item.visitStatus];
  const run = (task: () => Promise<ActionState>) => start(async () => {
    const result = await task();
    if (result.error) toast.error(errorText(result.error));
    else router.refresh();
  });
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border bg-card p-3 text-start shadow-sm transition hover:border-primary/40 hover:bg-accent/30 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="font-semibold tabular" dir="ltr">{item.startTime}–{item.endTime}</span>
          <Badge variant={item.confirmationStatus === "confirmed" ? "default" : "outline"}>{t(`confirmation.${item.confirmationStatus}`)}</Badge>
        </span>
        <span className="mt-2 block truncate font-medium"><bdi>{item.patientName}</bdi></span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {item.typeName ? <bdi>{item.typeName}</bdi> : t("noType")}{item.chairName ? <> · <bdi>{item.chairName}</bdi></> : null}
        </span>
        {reception || item.visitStatus !== "not_arrived" ? (
          <Badge className="mt-2" variant="secondary">{t(`visit.${item.visitStatus}`)}</Badge>
        ) : null}
      </button>
      {/* Reception desk: the next step in one tap (arrival, waiting room, treatment, done) without opening the card. */}
      {reception && canManage && next ? (
        <Button size="sm" variant="outline" className="mt-1.5 w-full" disabled={pending} onClick={() => run(() => visitStatusAction(item.id, next))}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          {t(`visitAction.${next}`)}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("details")}</DialogTitle>
            <DialogDescription><bdi dir="ltr">{item.startTime}–{item.endTime}</bdi> · <bdi>{item.providerTitle} {item.providerName}</bdi></DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <Link href={`/patients/${item.patientId}`} className="font-semibold hover:underline"><bdi>{item.patientName}</bdi></Link>
              <p className="text-xs text-muted-foreground"><bdi>{item.patientNumber}</bdi>{item.phone ? <> · <bdi dir="ltr">{formatPhone(item.phone)}</bdi></> : null}</p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">{t("type")}</dt><dd><bdi>{item.typeName ?? t("noType")}</bdi></dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("chair")}</dt><dd><bdi>{item.chairName ?? t("noChair")}</bdi></dd></div>
              </dl>
              {item.notes ? <p className="mt-3 whitespace-pre-line rounded-md bg-muted p-2 text-sm" dir="auto">{item.notes}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{t(`confirmation.${item.confirmationStatus}`)}</Badge>
              <Badge variant="secondary">{t(`visit.${item.visitStatus}`)}</Badge>
            </div>
            {canManage ? (
              <div className="space-y-3 border-t pt-4">
                {item.confirmationStatus !== "confirmed" && item.visitStatus === "not_arrived" ? (
                  <Button disabled={pending} onClick={() => run(() => confirmationAction(item.id, "confirmed"))}>{t("confirm")}</Button>
                ) : null}
                {next ? (
                  <Button disabled={pending} onClick={() => run(() => visitStatusAction(item.id, next))}>
                    {t(`visitAction.${next}`)}
                  </Button>
                ) : null}
                {item.visitStatus === "in_treatment" || item.visitStatus === "completed" ? (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">{t("afterVisit")}</p>
                    <div className="flex flex-wrap gap-2">
                      <ButtonLink href={`/patients/${item.patientId}/procedures/new`} variant="outline" size="sm">
                        <PlusIcon aria-hidden />
                        {tr("procedures.add")}
                      </ButtonLink>
                      <ButtonLink href={`/patients/${item.patientId}/billing/new`} variant="outline" size="sm">
                        <FileTextIcon aria-hidden />
                        {tr("billing.bill")}
                      </ButtonLink>
                    </div>
                  </div>
                ) : null}
                {item.visitStatus === "not_arrived" && setup && !moving ? (
                  <Button variant="outline" onClick={() => setMoving(true)}>
                    <MoveIcon aria-hidden />
                    {t("reschedule")}
                  </Button>
                ) : null}
                {moving && setup ? <RescheduleForm item={item} setup={setup} close={() => { setMoving(false); setOpen(false); }} /> : null}
                {item.visitStatus === "not_arrived" ? (
                  <div className="flex flex-wrap gap-2">
                    <CancelButton appointmentId={item.id} kind="cancelled" onDone={() => { setOpen(false); router.refresh(); }} />
                    <CancelButton appointmentId={item.id} kind="no_show" onDone={() => { setOpen(false); router.refresh(); }} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RescheduleForm({ item, setup, close }: { item: AppointmentViewItem; setup: Setup; close: () => void }) {
  const t = useTranslations("agenda");
  const router = useRouter();
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await rescheduleAppointmentAction(item.id, item.version, previous, formData);
    if (result.ok) {
      close();
      router.refresh();
      toast.success(t("rescheduled"));
    }
    return result;
  }, initialActionState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} onChange={typeDurationSync(setup)} className="space-y-3 rounded-lg border p-3" noValidate>
      <p className="text-xs text-muted-foreground">{t("rescheduleHint")}</p>
      <FormError error={state.error} />
      <input type="hidden" name="patientId" value={item.patientId} />
      <input type="hidden" name="notes" value={v.notes ?? item.notes ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("date")} name="date" type="date" required defaultValue={v.date ?? item.date} error={e.date} />
        <TextField label={t("time")} name="time" type="time" required defaultValue={v.time ?? item.startTime} error={e.time} />
        <SelectField label={t("provider")} name="providerId" defaultValue={v.providerId ?? item.providerId} options={setup.providers} error={e.providerId} />
        <SelectField label={t("chair")} name="chairId" defaultValue={v.chairId ?? item.chairId ?? ""} options={setup.chairs} placeholder={t("noChair")} />
        <SelectField label={t("type")} name="appointmentTypeId" defaultValue={v.appointmentTypeId ?? item.typeId ?? ""} options={setup.types} placeholder={t("noType")} />
        <TextField label={t("duration")} name="durationMin" type="number" min={5} max={480} step={5} defaultValue={v.durationMin ?? String(item.durationMin)} error={e.durationMin} />
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id={`move-override-${item.id}`} name="outsideHoursOverride" defaultChecked={v.outsideHoursOverride === "on"} />
        <Label htmlFor={`move-override-${item.id}`} className="font-normal">{t("outsideHoursOverride")}</Label>
      </div>
      <SubmitButton className="w-full">{t("save")}</SubmitButton>
    </form>
  );
}

function CancelButton({ appointmentId, kind, onDone }: { appointmentId: string; kind: "cancelled" | "no_show"; onDone: () => void }) {
  const t = useTranslations("agenda");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await cancelAppointmentAction(appointmentId, kind, previous, formData);
    if (result.ok) { setOpen(false); onDone(); }
    return result;
  }, initialActionState);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>{t(kind === "cancelled" ? "cancelAppointment" : "markNoShow")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(kind === "cancelled" ? "cancelAppointment" : "markNoShow")}</DialogTitle>
            <DialogDescription>{t(kind === "cancelled" ? "cancelHint" : "noShowHint")}</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <FormError error={state.error} />
            {kind === "cancelled" ? <TextField label={t("reason")} name="reason" required defaultValue={state.values?.reason} /> : <input type="hidden" name="reason" value="" />}
            <SubmitButton variant="destructive" className="w-full">{t("confirm")}</SubmitButton>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EmptyAgenda({ reception = false }: { reception?: boolean }) {
  const t = useTranslations("agenda");
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
      {reception ? <UserRoundIcon className="mx-auto mb-2 size-8" aria-hidden /> : <Clock3Icon className="mx-auto mb-2 size-8" aria-hidden />}
      <p>{t(reception ? "emptyReception" : "emptyDay")}</p>
    </div>
  );
}
