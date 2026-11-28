"use client";

import { useActionState, useState, useTransition } from "react";
import { BadgeCheckIcon, CheckIcon, CopyIcon, HourglassIcon, InboxIcon, MailIcon, MessageCircleIcon, PhoneIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { DEFAULT_TRIAL_DAYS, trialState, trialUrgent } from "@/lib/trial";
import { BILLABLE_MODULES } from "@/server/authz/modules";
import { convertToPaidAction, extendTrialAction, provisionClinicAction, setTrialRequestStatusAction, updateClinicModulesAction } from "../actions";
import type { PlatformClinic, TrialRequest, TrialRequestStatus } from "../server";

const EXTEND_CHOICES = [7, 14, 30, 60] as const;
/** A trial shows the whole product, except per-message WhatsApp (a cost to the platform) and the unbuilt laboratory. */
const TRIAL_DEFAULT_MODULES = BILLABLE_MODULES.filter((m) => m !== "whatsapp_reminders" && m !== "laboratory");
const waLink = (phone: string, text?: string) => `https://wa.me/${phone.replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

/** Prefill of the "create a clinic" form (from a trial request). */
type Draft = { requestId?: string; clinicName?: string; ownerFullName?: string; email?: string; locale?: string; phone?: string };

function ModuleChoices({ selected = [] }: { selected?: readonly string[] }) {
  const t = useTranslations("platform.modules");
  return <fieldset className="grid gap-2 sm:grid-cols-2">
    <legend className="mb-2 text-sm font-medium">{t("title")}</legend>
    {BILLABLE_MODULES.map((module) => <label key={module} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
      <input type="checkbox" name="modules" value={module} defaultChecked={selected.includes(module)} className="mt-0.5 size-4 accent-primary" />
      <span><span className="block font-medium">{t(`${module}.name`)}</span><span className="text-xs text-muted-foreground">{t(`${module}.hint`)}</span></span>
    </label>)}
  </fieldset>;
}

export function PlatformConsole({ clinics, requests, now }: { clinics: PlatformClinic[]; requests: TrialRequest[]; now: string }) {
  const t = useTranslations("platform");
  const at = new Date(now);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formKey, setFormKey] = useState(0);
  const openCreate = (value: Draft) => { setFormKey((k) => k + 1); setDraft(value); };
  const states = clinics.map((c) => trialState(c.trialEndsAt, at));
  const summary = {
    onTrial: states.filter((s) => s.onTrial && !s.expired).length,
    endingSoon: states.filter((s) => s.onTrial && !s.expired && trialUrgent(s)).length,
    expired: states.filter((s) => s.expired).length,
    paid: states.filter((s) => !s.onTrial).length,
    newRequests: requests.filter((r) => r.status === "new").length,
  };
  return <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1><p className="mt-1 text-muted-foreground">{t("subtitle")}</p></div>
      <Button onClick={() => openCreate({})}><PlusIcon aria-hidden />{t("createClinic")}</Button>
    </div>
    <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {(["newRequests", "onTrial", "endingSoon", "expired", "paid"] as const).map((key) => <div key={key} className="rounded-xl border bg-card p-3">
        <dt className="text-xs text-muted-foreground">{t(`summary.${key}`)}</dt><dd className="text-2xl font-semibold tabular-nums">{summary[key]}</dd>
      </div>)}
    </dl>

    <section aria-labelledby="trial-requests" className="mb-10">
      <h2 id="trial-requests" className="mb-3 flex items-center gap-2 text-lg font-semibold"><InboxIcon className="size-5" aria-hidden />{t("requests.title")}</h2>
      {requests.length ? <div className="grid gap-3 xl:grid-cols-2">
        {requests.map((request) => <RequestCard key={request.id} request={request} now={at} onCreate={() => openCreate({
          requestId: request.id, clinicName: request.clinicName, ownerFullName: request.contactName, email: request.email, locale: request.locale, phone: request.phone,
        })} />)}
      </div> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("requests.empty")}</p>}
    </section>

    <section aria-labelledby="clinics">
      <h2 id="clinics" className="mb-3 text-lg font-semibold">{t("clinicsTitle")}</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {clinics.map((clinic, i) => <ClinicCard key={clinic.id} clinic={clinic} state={states[i]!} now={at} />)}
        {!clinics.length ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</p> : null}
      </div>
    </section>

    <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("createClinic")}</DialogTitle><DialogDescription>{t("createHint")}</DialogDescription></DialogHeader>
        {draft ? <CreateClinicForm key={formKey} draft={draft} /> : null}
      </DialogContent>
    </Dialog>
  </>;
}

function CreateClinicForm({ draft }: { draft: Draft }) {
  const t = useTranslations("platform");
  const [state, action] = useActionState(provisionClinicAction, initialActionState);
  const [plan, setPlan] = useState(state.values?.plan ?? "trial");
  const activationPath = (state.data as { activationPath?: string } | undefined)?.activationPath;
  if (activationPath) return <ActivationLink path={activationPath} draft={draft} />;
  const v = { ...draft, ...state.values };
  return <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
    <div className="sm:col-span-2"><FormError error={state.error} /></div>
    {draft.requestId ? <input type="hidden" name="requestId" value={draft.requestId} /> : null}
    <TextField label={t("clinicName")} name="clinicName" required defaultValue={v.clinicName} error={state.fieldErrors?.clinicName} />
    <TextField label={t("ownerName")} name="ownerFullName" required defaultValue={v.ownerFullName} error={state.fieldErrors?.ownerFullName} />
    <TextField label={t("ownerEmail")} name="email" type="email" dir="ltr" required defaultValue={v.email} error={state.fieldErrors?.email} />
    <SelectField label={t("kind")} name="kind" required defaultValue={state.values?.kind ?? "solo"} options={["solo","group","specialist","pediatric","multi_branch"].map((value) => ({ value, label: t(`kinds.${value}`) }))} />
    <SelectField label={t("locale")} name="locale" required defaultValue={v.locale ?? "fr"} options={["fr","en","ar"].map((value) => ({ value, label: t(`locales.${value}`) }))} />
    <label className="flex items-center gap-2 self-end rounded-lg border p-3 text-sm"><input type="checkbox" name="ownerIsDentist" defaultChecked={state.values?.ownerIsDentist !== "off"} className="size-4 accent-primary" />{t("ownerDentist")}</label>
    <SelectField label={t("trial.plan")} name="plan" value={plan} onChange={(e) => setPlan(e.target.value)} options={[{ value: "trial", label: t("trial.planTrial") }, { value: "paid", label: t("trial.planPaid") }]} />
    {plan === "trial"
      ? <TextField label={t("trial.days")} name="trialDays" type="number" min={1} max={120} required defaultValue={state.values?.trialDays ?? String(DEFAULT_TRIAL_DAYS)} hint={t("trial.daysHint")} />
      : <div />}
    <div className="sm:col-span-2"><ModuleChoices selected={TRIAL_DEFAULT_MODULES} /></div>
    <SubmitButton className="sm:col-span-2">{t("provision")}</SubmitButton>
  </form>;
}

function ActivationLink({ path, draft }: { path: string; draft: Draft }) {
  const t = useTranslations("platform");
  const [copied, setCopied] = useState(false);
  const url = typeof location === "undefined" ? path : `${location.origin}${path}`;
  return <div className="rounded-xl border border-success/40 bg-success/10 p-4">
    <p className="flex items-center gap-2 font-medium"><CheckIcon className="size-4" />{t("created")}</p>
    <p className="mt-1 text-sm text-muted-foreground">{t("activationHint")}</p>
    <code className="mt-3 block break-all rounded bg-background p-3 text-xs" dir="ltr">{url}</code>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}><CopyIcon />{copied ? t("copied") : t("copy")}</Button>
      {draft.phone ? <a href={waLink(draft.phone, t("requests.activationMessage", { name: draft.ownerFullName ?? "", link: url }))} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted"><MessageCircleIcon className="size-4" aria-hidden />{t("requests.sendWhatsApp")}</a> : null}
    </div>
  </div>;
}

function RequestCard({ request, now, onCreate }: { request: TrialRequest; now: Date; onCreate: () => void }) {
  const t = useTranslations("platform.requests");
  const format = useFormatter();
  const [pending, start] = useTransition();
  const setStatus = (status: TrialRequestStatus) => start(async () => {
    const result = await setTrialRequestStatusAction(request.id, status);
    if (result.ok) toast.success(t("statusSaved")); else toast.error(t("statusFailed"));
  });
  const open = request.status === "new" || request.status === "contacted";
  return <article className={`rounded-xl border bg-card p-4 ${request.status === "new" ? "border-primary/40" : ""}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold" dir="auto">{request.clinicName}</h3>
        <p className="text-sm text-muted-foreground"><bdi>{request.contactName}</bdi>{request.city ? <> · <bdi>{request.city}</bdi></> : null}{request.practitioners ? <> · {t("practitioners", { count: request.practitioners })}</> : null}</p>
      </div>
      <div className="text-end"><Badge variant={request.status === "new" ? "default" : "outline"}>{t(`statuses.${request.status}`)}</Badge><p className="mt-1 text-xs text-muted-foreground">{format.relativeTime(request.createdAt, now)}</p></div>
    </div>
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <a href={`tel:${request.phone}`} className="inline-flex items-center gap-1 text-primary hover:underline" dir="ltr"><PhoneIcon className="size-3.5" aria-hidden />{request.phone}</a>
      <a href={waLink(request.phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><MessageCircleIcon className="size-3.5" aria-hidden />WhatsApp</a>
      <a href={`mailto:${request.email}`} className="inline-flex items-center gap-1 text-primary hover:underline" dir="ltr"><MailIcon className="size-3.5" aria-hidden />{request.email}</a>
    </p>
    {request.message ? <p className="mt-2 whitespace-pre-line rounded-lg bg-muted/50 p-2 text-sm" dir="auto">{request.message}</p> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {open ? <Button size="sm" onClick={onCreate}><PlusIcon aria-hidden />{t("createTrial")}</Button> : null}
      {request.status === "new" ? <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus("contacted")}>{t("markContacted")}</Button> : null}
      {open ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus("declined")}>{t("decline")}</Button> : null}
      {request.status === "declined" ? <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus("contacted")}>{t("reopen")}</Button> : null}
      {request.status === "converted" ? <p className="flex items-center gap-1 text-sm text-success"><BadgeCheckIcon className="size-4" aria-hidden />{t("converted")}</p> : null}
    </div>
  </article>;
}

function PlanBadge({ state }: { state: ReturnType<typeof trialState> }) {
  const t = useTranslations("platform.trial");
  if (!state.onTrial) return <Badge variant="secondary">{t("paid")}</Badge>;
  if (state.expired) return <Badge variant="destructive">{t("expired")}</Badge>;
  return <Badge variant={trialUrgent(state) ? "destructive" : "outline"}><HourglassIcon aria-hidden />{t("daysLeft", { days: state.daysLeft ?? 0 })}</Badge>;
}

function ClinicCard({ clinic, state, now }: { clinic: PlatformClinic; state: ReturnType<typeof trialState>; now: Date }) {
  const t = useTranslations("platform");
  const format = useFormatter();
  const [dialog, setDialog] = useState<null | "modules" | "extend" | "paid">(null);
  const close = (message: string) => (result: ActionState) => { if (result.ok) { setDialog(null); toast.success(message); } return result; };
  const [modulesState, modulesAction] = useActionState(async (previous: ActionState, formData: FormData) =>
    close(t("modulesUpdated"))(await updateClinicModulesAction(clinic.id, previous, formData)), initialActionState);
  const [extendState, extendAction] = useActionState(async (previous: ActionState, formData: FormData) =>
    close(t("trial.extended"))(await extendTrialAction(clinic.id, previous, formData)), initialActionState);
  const [paidState, paidAction] = useActionState(async () => close(t("trial.convertedToast"))(await convertToPaidAction(clinic.id)), initialActionState);
  const u = clinic.usage;
  return <article className="rounded-xl border bg-card p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="font-semibold" dir="auto">{clinic.name}</h3><p className="text-sm text-muted-foreground"><bdi>{clinic.ownerName}</bdi> · <bdi>{clinic.ownerEmail}</bdi></p></div>
      <div className="flex flex-col items-end gap-1"><PlanBadge state={state} />{clinic.status !== "active" ? <Badge variant="outline">{t(`statuses.${clinic.status}`)}</Badge> : null}</div>
    </div>
    {state.onTrial && state.endsAt ? <p className="mt-2 text-xs text-muted-foreground">{t("trial.endsOn", { date: format.dateTime(state.endsAt, { dateStyle: "medium" }) })}</p> : null}
    <p className="mt-3 text-sm">{t("usage.line", { patients: u.patients, appointments: u.appointments30d, invoices: u.invoices30d })}</p>
    <p className="text-xs text-muted-foreground">{u.lastActivityAt ? t("usage.lastActivity", { when: format.relativeTime(u.lastActivityAt, now) }) : t("usage.noActivity")}</p>
    <div className="mt-3 flex flex-wrap gap-1.5">{clinic.enabledModules.filter((m) => m !== "core").map((module) => <Badge key={module} variant="secondary">{t(`modules.${module}.name`)}</Badge>)}</div>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => setDialog("modules")}><Settings2Icon />{t("manageModules")}</Button>
      <Button variant="outline" size="sm" onClick={() => setDialog("extend")}><HourglassIcon />{state.onTrial ? t("trial.extend") : t("trial.start")}</Button>
      {state.onTrial ? <Button size="sm" onClick={() => setDialog("paid")}><BadgeCheckIcon />{t("trial.convert")}</Button> : null}
    </div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {dialog === "modules" ? <>
          <DialogHeader><DialogTitle>{t("manageClinic", { clinic: clinic.name })}</DialogTitle><DialogDescription>{t("enforcementHint")}</DialogDescription></DialogHeader>
          <form action={modulesAction} className="space-y-4"><FormError error={modulesState.error} /><ModuleChoices selected={clinic.enabledModules} /><SubmitButton className="w-full">{t("saveModules")}</SubmitButton></form>
        </> : null}
        {dialog === "extend" ? <>
          <DialogHeader><DialogTitle>{state.onTrial ? t("trial.extend") : t("trial.start")}</DialogTitle><DialogDescription>{t("trial.extendHint")}</DialogDescription></DialogHeader>
          <form action={extendAction} className="space-y-4"><FormError error={extendState.error} />
            <SelectField label={t("trial.addDays")} name="days" defaultValue="14" options={EXTEND_CHOICES.map((d) => ({ value: String(d), label: t("trial.daysOption", { days: d }) }))} />
            <SubmitButton className="w-full">{t("trial.save")}</SubmitButton>
          </form>
        </> : null}
        {dialog === "paid" ? <>
          <DialogHeader><DialogTitle>{t("trial.convert")}</DialogTitle><DialogDescription>{t("trial.convertHint", { clinic: clinic.name })}</DialogDescription></DialogHeader>
          <form action={paidAction} className="space-y-4"><FormError error={paidState.error} /><SubmitButton className="w-full">{t("trial.convertConfirm")}</SubmitButton></form>
        </> : null}
      </DialogContent>
    </Dialog>
  </article>;
}
