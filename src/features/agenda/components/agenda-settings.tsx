"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { FormError, SelectField, SubmitButton, TextField, useErrorText } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialActionState, type ActionState } from "@/lib/action-state";
import {
  addTimeOffAction,
  createChairAction,
  deleteTimeOffAction,
  saveHoursAction,
  saveTypeAction,
  toggleChairAction,
} from "../settings-actions";

function useRefreshing(fn: (p: ActionState, fd: FormData) => Promise<ActionState>, onOk?: (r: ActionState) => void) {
  const router = useRouter();
  return useActionState(async (p: ActionState, fd: FormData) => {
    const r = await fn(p, fd);
    if (r.ok) {
      onOk?.(r);
      router.refresh();
    }
    return r;
  }, initialActionState);
}

function useRun() {
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const run = (task: () => Promise<ActionState>) =>
    start(async () => {
      const r = await task();
      if (r.error) toast.error(errorText(r.error));
      else router.refresh();
    });
  return { pending, run };
}

// --- Chairs -------------------------------------------------------------------

export function ChairsCard({ chairs, canManage }: { chairs: { id: string; name: string; isActive: boolean }[]; canManage: boolean }) {
  const t = useTranslations("agendaSettings");
  const { pending, run } = useRun();
  const [state, action] = useRefreshing(createChairAction);
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 font-semibold">{t("chairs")}</h2>
      <ul className="mb-3 divide-y text-sm">
        {chairs.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2">
            <span className={c.isActive ? "" : "text-muted-foreground line-through"}><bdi>{c.name}</bdi></span>
            {canManage ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => toggleChairAction(c.id, !c.isActive))}>
                {c.isActive ? t("deactivate") : t("activate")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form action={action} className="flex items-end gap-2">
          <FormError error={state.error} />
          <TextField label={t("chairName")} name="name" fieldClassName="flex-1" placeholder={t("chairPlaceholder")} />
          <SubmitButton variant="outline"><PlusIcon aria-hidden />{t("add")}</SubmitButton>
        </form>
      ) : null}
    </section>
  );
}

// --- Appointment types ----------------------------------------------------------

type TypeRow = { id: string; name: { fr: string; en?: string; ar?: string }; defaultDurationMin: number; isBookableOnline: boolean; isActive: boolean };

export function TypesCard({ types, canManage, locale }: { types: TypeRow[]; canManage: boolean; locale: string }) {
  const t = useTranslations("agendaSettings");
  const [editing, setEditing] = useState<TypeRow | "new" | null>(null);
  const label = (n: TypeRow["name"]) => (n as Record<string, string | undefined>)[locale] || n.fr;
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("types")}</h2>
        {canManage ? <Button size="sm" variant="outline" onClick={() => setEditing("new")}><PlusIcon aria-hidden />{t("add")}</Button> : null}
      </div>
      <ul className="divide-y text-sm">
        {types.map((ty) => (
          <li key={ty.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className={ty.isActive ? "" : "text-muted-foreground line-through"}>
              <bdi>{label(ty.name)}</bdi> · {t("minutes", { n: ty.defaultDurationMin })}
            </span>
            <span className="flex items-center gap-2">
              {ty.isBookableOnline ? <Badge variant="secondary">{t("online")}</Badge> : null}
              {canManage ? (
                <Button size="icon-sm" variant="ghost" aria-label={t("edit")} onClick={() => setEditing(ty)}>
                  <PencilIcon aria-hidden />
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("newType") : t("edit")}</DialogTitle>
            <DialogDescription>{t("typeHint")}</DialogDescription>
          </DialogHeader>
          {editing ? <TypeForm key={editing === "new" ? "new" : editing.id} type={editing === "new" ? null : editing} close={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TypeForm({ type, close }: { type: TypeRow | null; close: () => void }) {
  const t = useTranslations("agendaSettings");
  const [state, action] = useRefreshing(saveTypeAction.bind(null, type?.id ?? null), close);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormError error={state.error} />
      <TextField label={t("nameFr")} name="nameFr" required defaultValue={v.nameFr ?? type?.name.fr} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("nameEn")} name="nameEn" optionalLabel defaultValue={v.nameEn ?? type?.name.en} />
        <TextField label={t("nameAr")} name="nameAr" optionalLabel dir="rtl" lang="ar" defaultValue={v.nameAr ?? type?.name.ar} />
      </div>
      <TextField label={t("duration")} name="durationMin" type="number" min={5} max={480} step={5} required defaultValue={v.durationMin ?? String(type?.defaultDurationMin ?? 30)} />
      <div className="flex items-center gap-3">
        <Checkbox id="type-online" name="bookableOnline" defaultChecked={type?.isBookableOnline ?? false} />
        <Label htmlFor="type-online" className="font-normal">{t("bookableOnline")}</Label>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox id="type-active" name="active" defaultChecked={type?.isActive ?? true} />
        <Label htmlFor="type-active" className="font-normal">{t("active")}</Label>
      </div>
      {/* Unchecked checkboxes are absent from FormData; this marker lets the server read "active" explicitly. */}
      <input type="hidden" name="activeMarker" value="1" />
      <SubmitButton className="w-full">{t("save")}</SubmitButton>
    </form>
  );
}

// --- Working hours ------------------------------------------------------------------

const ORDER = [7, 1, 2, 3, 4, 5, 6]; // Sunday first (Algerian working week)

export function HoursCard({
  provider,
  hours,
  weekdayNames,
  canManage,
}: {
  provider: { id: string; name: string };
  hours: { weekday: number; startTime: string; endTime: string }[];
  weekdayNames: Record<number, string>;
  canManage: boolean;
}) {
  const t = useTranslations("agendaSettings");
  const [state, action] = useRefreshing(saveHoursAction.bind(null, provider.id), () => toast.success(t("saved")));
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-1 font-semibold"><bdi>{provider.name}</bdi></h2>
      <p className="mb-3 text-xs text-muted-foreground">{t("hoursHint")}</p>
      <form action={action} className="space-y-2" noValidate>
        <FormError error={state.error} />
        {ORDER.map((wd) => {
          const day = hours.filter((h) => h.weekday === wd);
          const [a, b] = [day[0], day[1]];
          return (
            <fieldset key={wd} className="grid grid-cols-[6.5rem_1fr] items-center gap-2 sm:grid-cols-[8rem_1fr]" disabled={!canManage}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`d${wd}_on`} defaultChecked={day.length > 0} className="size-4 accent-[var(--primary)]" />
                {weekdayNames[wd]}
              </label>
              <div className="flex flex-wrap items-center gap-1.5 text-sm" dir="ltr">
                <Input type="time" name={`d${wd}_s1`} defaultValue={a?.startTime.slice(0, 5) ?? ""} className="h-9 w-[7.75rem]" aria-label={`${weekdayNames[wd]} ${t("start")} 1`} />
                <span>–</span>
                <Input type="time" name={`d${wd}_e1`} defaultValue={a?.endTime.slice(0, 5) ?? ""} className="h-9 w-[7.75rem]" aria-label={`${weekdayNames[wd]} ${t("end")} 1`} />
                <span className="px-1 text-muted-foreground">/</span>
                <Input type="time" name={`d${wd}_s2`} defaultValue={b?.startTime.slice(0, 5) ?? ""} className="h-9 w-[7.75rem]" aria-label={`${weekdayNames[wd]} ${t("start")} 2`} />
                <span>–</span>
                <Input type="time" name={`d${wd}_e2`} defaultValue={b?.endTime.slice(0, 5) ?? ""} className="h-9 w-[7.75rem]" aria-label={`${weekdayNames[wd]} ${t("end")} 2`} />
              </div>
            </fieldset>
          );
        })}
        {canManage ? <SubmitButton className="mt-2">{t("save")}</SubmitButton> : null}
      </form>
    </section>
  );
}

// --- Time off ----------------------------------------------------------------------

export function TimeOffCard({
  items,
  providers,
  canManage,
  today,
}: {
  items: { id: string; kind: string; label: string; who: string; reason: string | null }[];
  providers: { value: string; label: string }[];
  canManage: boolean;
  today: string;
}) {
  const t = useTranslations("agendaSettings");
  const { pending, run } = useRun();
  const [state, action] = useRefreshing(addTimeOffAction, (r) => {
    const n = (r.data as { overlapping: number }).overlapping;
    if (n > 0) toast.warning(t("overlapWarning", { count: n }));
    else toast.success(t("saved"));
  });
  const v = state.values ?? {};
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-1 font-semibold">{t("timeOff")}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{t("timeOffHint")}</p>
      {items.length ? (
        <ul className="mb-3 divide-y text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{t(`kind.${i.kind as "leave"}`)}</span> · <bdi>{i.who}</bdi>
                <span className="block text-xs text-muted-foreground">{i.label}{i.reason ? ` · ${i.reason}` : ""}</span>
              </span>
              {canManage ? (
                <Button size="icon-sm" variant="ghost" aria-label={t("delete")} disabled={pending} onClick={() => run(() => deleteTimeOffAction(i.id))}>
                  <Trash2Icon aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">{t("noTimeOff")}</p>
      )}
      {canManage ? (
        <form action={action} className="grid gap-3 sm:grid-cols-2" noValidate>
          <FormError error={state.error} />
          <SelectField label={t("who")} name="providerId" defaultValue={v.providerId ?? ""} options={[{ value: "", label: t("wholeClinic") }, ...providers]} />
          <SelectField label={t("kindLabel")} name="kind" defaultValue={v.kind ?? "leave"} options={(["leave", "holiday", "blocked"] as const).map((k) => ({ value: k, label: t(`kind.${k}`) }))} />
          <TextField label={t("from")} name="startDate" type="date" min={today} required defaultValue={v.startDate ?? today} error={state.fieldErrors?.startDate} />
          <TextField label={t("startTime")} name="startTime" type="time" optionalLabel defaultValue={v.startTime} />
          <TextField label={t("to")} name="endDate" type="date" min={today} defaultValue={v.endDate ?? today} />
          <TextField label={t("endTime")} name="endTime" type="time" optionalLabel defaultValue={v.endTime} />
          <TextField label={t("reason")} name="reason" optionalLabel fieldClassName="sm:col-span-2" defaultValue={v.reason} />
          <SubmitButton variant="outline" className="sm:col-span-2"><PlusIcon aria-hidden />{t("addTimeOff")}</SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
