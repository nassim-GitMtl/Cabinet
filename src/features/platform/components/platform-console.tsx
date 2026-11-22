"use client";

import { useActionState, useState } from "react";
import { CheckIcon, CopyIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { BILLABLE_MODULES } from "@/server/authz/modules";
import { provisionClinicAction, updateClinicModulesAction } from "../actions";
import type { PlatformClinic } from "../server";

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

export function PlatformConsole({ clinics }: { clinics: PlatformClinic[] }) {
  const t = useTranslations("platform");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(provisionClinicAction, initialActionState);
  const activationPath = (state.data as { activationPath?: string } | undefined)?.activationPath;
  return <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1><p className="mt-1 text-muted-foreground">{t("subtitle")}</p></div>
      <Button onClick={() => setOpen(true)}><PlusIcon aria-hidden />{t("createClinic")}</Button>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      {clinics.map((clinic) => <ClinicCard key={clinic.id} clinic={clinic} />)}
      {!clinics.length ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</p> : null}
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("createClinic")}</DialogTitle><DialogDescription>{t("createHint")}</DialogDescription></DialogHeader>
        {activationPath ? <ActivationLink path={activationPath} /> : <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormError error={state.error} />
          <TextField label={t("clinicName")} name="clinicName" required defaultValue={state.values?.clinicName} error={state.fieldErrors?.clinicName} />
          <TextField label={t("ownerName")} name="ownerFullName" required defaultValue={state.values?.ownerFullName} error={state.fieldErrors?.ownerFullName} />
          <TextField label={t("ownerEmail")} name="email" type="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
          <SelectField label={t("kind")} name="kind" required defaultValue={state.values?.kind ?? "solo"} options={["solo","group","specialist","pediatric","multi_branch"].map((value) => ({ value, label: t(`kinds.${value}`) }))} />
          <SelectField label={t("locale")} name="locale" required defaultValue={state.values?.locale ?? "fr"} options={["fr","en","ar"].map((value) => ({ value, label: t(`locales.${value}`) }))} />
          <label className="flex items-center gap-2 self-end rounded-lg border p-3 text-sm"><input type="checkbox" name="ownerIsDentist" defaultChecked={state.values?.ownerIsDentist !== "off"} className="size-4 accent-primary" />{t("ownerDentist")}</label>
          <div className="sm:col-span-2"><ModuleChoices /></div>
          <SubmitButton className="sm:col-span-2">{t("provision")}</SubmitButton>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}

function ActivationLink({ path }: { path: string }) {
  const t = useTranslations("platform");
  const [copied, setCopied] = useState(false);
  const url = typeof location === "undefined" ? path : `${location.origin}${path}`;
  return <div className="rounded-xl border border-success/40 bg-success/10 p-4"><p className="flex items-center gap-2 font-medium"><CheckIcon className="size-4" />{t("created")}</p><p className="mt-1 text-sm text-muted-foreground">{t("activationHint")}</p><code className="mt-3 block break-all rounded bg-background p-3 text-xs" dir="ltr">{url}</code><Button variant="outline" className="mt-3" onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}><CopyIcon />{copied ? t("copied") : t("copy")}</Button></div>;
}

function ClinicCard({ clinic }: { clinic: PlatformClinic }) {
  const t = useTranslations("platform");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await updateClinicModulesAction(clinic.id, previous, formData);
    if (result.ok) { setOpen(false); toast.success(t("modulesUpdated")); }
    return result;
  }, initialActionState);
  return <article className="rounded-xl border bg-card p-5">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold" dir="auto">{clinic.name}</h2><p className="text-sm text-muted-foreground"><bdi>{clinic.ownerName}</bdi> · <bdi>{clinic.ownerEmail}</bdi></p></div><Badge variant="outline">{t(`statuses.${clinic.status}`)}</Badge></div>
    <div className="mt-4 flex flex-wrap gap-1.5">{clinic.enabledModules.filter((m) => m !== "core").map((module) => <Badge key={module} variant="secondary">{t(`modules.${module}.name`)}</Badge>)}</div>
    <Button variant="outline" size="sm" className="mt-4" onClick={() => setOpen(true)}><Settings2Icon />{t("manageModules")}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{t("manageClinic", { clinic: clinic.name })}</DialogTitle><DialogDescription>{t("enforcementHint")}</DialogDescription></DialogHeader><form action={action} className="space-y-4"><FormError error={state.error} /><ModuleChoices selected={clinic.enabledModules} /><SubmitButton className="w-full">{t("saveModules")}</SubmitButton></form></DialogContent></Dialog>
  </article>;
}
