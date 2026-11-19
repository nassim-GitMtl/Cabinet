"use client";

import { useActionState, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { initialActionState } from "@/lib/action-state";
import { createInstrumentSetAction, createSterilizerAction, recordSterilizationCycleAction } from "../actions";

type Option = { value: string; label: string };
type PackDraft = { key: number; instrumentSetId: string; label: string; expiresOn: string; quantity: number };

export function SetupForms({ branches }: { branches: Option[] }) {
  const t = useTranslations("sterilization");
  const [machineState, machineAction] = useActionState(createSterilizerAction, initialActionState);
  const [setState, setAction] = useActionState(createInstrumentSetAction, initialActionState);
  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-2">
      <form action={machineAction} className="rounded-2xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">{t("setup.addSterilizer")}</h2><FormError error={machineState.error} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField name="name" label={t("fields.sterilizerName")} required error={machineState.fieldErrors?.name} />
          <SelectField name="branchId" label={t("fields.branch")} options={branches} placeholder={t("choose")} required error={machineState.fieldErrors?.branchId} />
          <TextField name="serialNumber" label={t("fields.serialNumber")} optionalLabel fieldClassName="sm:col-span-2" error={machineState.fieldErrors?.serialNumber} />
        </div><SubmitButton className="mt-3">{t("actions.add")}</SubmitButton>
      </form>
      <form action={setAction} className="rounded-2xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">{t("setup.addSet")}</h2><FormError error={setState.error} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField name="code" label={t("fields.setCode")} required error={setState.fieldErrors?.code} />
          <TextField name="name" label={t("fields.setName")} required error={setState.fieldErrors?.name} />
          <TextAreaField name="contents" label={t("fields.contents")} optionalLabel fieldClassName="sm:col-span-2" error={setState.fieldErrors?.contents} />
        </div><SubmitButton className="mt-3">{t("actions.add")}</SubmitButton>
      </form>
    </div>
  );
}

export function CycleForm({ branches, sterilizers, sets, today, nowTime }: { branches: Option[]; sterilizers: Array<Option & { branchId: string }>; sets: Option[]; today: string; nowTime: string }) {
  const t = useTranslations("sterilization");
  const [state, action] = useActionState(recordSterilizationCycleAction, initialActionState);
  const [branchId, setBranchId] = useState(branches[0]?.value ?? "");
  const [packs, setPacks] = useState<PackDraft[]>([{ key: 1, instrumentSetId: sets[0]?.value ?? "", label: "", expiresOn: "", quantity: 1 }]);
  const update = (key: number, patch: Partial<PackDraft>) => setPacks((rows) => rows.map((row) => row.key === key ? { ...row, ...patch } : row));
  const add = () => setPacks((rows) => [...rows, { key: Math.max(0, ...rows.map((x) => x.key)) + 1, instrumentSetId: sets[0]?.value ?? "", label: "", expiresOn: "", quantity: 1 }]);
  return (
    <form action={action} className="mb-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div><h2 className="font-semibold">{t("record.title")}</h2><p className="text-sm text-muted-foreground">{t("record.hint")}</p></div>
      <FormError error={state.error} />
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SelectField name="branchId" label={t("fields.branch")} options={branches} value={branchId} onChange={(event) => setBranchId(event.target.value)} required />
        <SelectField name="sterilizerId" label={t("fields.sterilizer")} options={sterilizers.filter((x) => x.branchId === branchId)} placeholder={t("choose")} required error={state.fieldErrors?.sterilizerId} />
        <TextField name="reference" label={t("fields.reference")} required error={state.fieldErrors?.reference} />
        <TextField name="program" label={t("fields.program")} required error={state.fieldErrors?.program} />
        <TextField type="date" name="startedDate" label={t("fields.startedDate")} defaultValue={today} required error={state.fieldErrors?.startedDate} />
        <TextField type="time" name="startedTime" label={t("fields.startedTime")} defaultValue={nowTime} required error={state.fieldErrors?.startedTime} />
        <TextField type="number" step="0.1" min="0" name="temperatureC" label={t("fields.temperature")} optionalLabel />
        <TextField type="number" step="0.01" min="0" name="pressureBar" label={t("fields.pressure")} optionalLabel />
        <TextField type="number" step="0.1" min="0" name="holdMinutes" label={t("fields.hold")} optionalLabel />
        {(["chemicalIndicator", "airRemovalTest", "biologicalIndicator"] as const).map((name) => <SelectField key={name} name={name} label={t(`fields.${name}`)} defaultValue={name === "biologicalIndicator" ? "not_used" : "pass"} options={["not_used", "pending", "pass", "fail"].map((value) => ({ value, label: t(`indicator.${value}`) }))} required />)}
        <TextAreaField name="notes" label={t("fields.notes")} optionalLabel fieldClassName="md:col-span-2 xl:col-span-4" />
      </div>
      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">{t("packs.title")}</h3><p className="text-xs text-muted-foreground">{t("packs.hint")}</p></div><Button type="button" variant="outline" onClick={add}><PlusIcon aria-hidden />{t("packs.add")}</Button></div>
        <input type="hidden" name="packs" value={JSON.stringify(packs.map((pack) => ({ instrumentSetId: pack.instrumentSetId, label: pack.label, expiresOn: pack.expiresOn, quantity: pack.quantity })))} />
        <div className="mt-3 space-y-3">{packs.map((pack, index) => <div key={pack.key} className="grid gap-3 rounded-xl border bg-muted/20 p-3 md:grid-cols-[1fr_1fr_10rem_6rem_auto]">
          <SelectField name={`set-${pack.key}`} label={t("fields.instrumentSet")} options={sets} value={pack.instrumentSetId} onChange={(e) => update(pack.key, { instrumentSetId: e.target.value })} placeholder={t("packs.loose")} />
          <TextField name={`label-${pack.key}`} label={t("fields.packLabel")} value={pack.label} onChange={(e) => update(pack.key, { label: e.target.value })} />
          <TextField type="date" name={`expiry-${pack.key}`} label={t("fields.expiresOn")} value={pack.expiresOn} onChange={(e) => update(pack.key, { expiresOn: e.target.value })} />
          <TextField type="number" min="1" max="50" name={`qty-${pack.key}`} label={t("fields.quantity")} value={pack.quantity} onChange={(e) => update(pack.key, { quantity: Number(e.target.value) })} />
          <Button type="button" variant="ghost" size="icon" className="self-end" disabled={packs.length === 1} onClick={() => setPacks((rows) => rows.filter((x) => x.key !== pack.key))} aria-label={t("packs.remove", { number: index + 1 })}><Trash2Icon aria-hidden /></Button>
        </div>)}</div>
        {state.fieldErrors?.packs ? <p className="mt-2 text-sm text-destructive">{t("errors.packsRequired")}</p> : null}
      </div>
      <SubmitButton className="mt-5">{t("actions.record")}</SubmitButton>
    </form>
  );
}
