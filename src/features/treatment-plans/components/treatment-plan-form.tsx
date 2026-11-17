"use client";

import { useActionState, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { FormError, SubmitButton, TextAreaField, TextField, useErrorText } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ServiceCombobox } from "@/features/catalog/components/service-combobox";
import type { ServicePickerData } from "@/features/catalog/server";
import { ARCHES, QUADRANTS, SURFACES } from "@/features/procedures/schemas";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/money";
import { createTreatmentPlanAction, reviseTreatmentPlanAction } from "../actions";

export type PlanItemDraft = {
  key: string;
  serviceId: string;
  quantity: number;
  toothNumber: string | null;
  surfaces: string[];
  arch: string | null;
  quadrant: string | null;
};

type Props = {
  patientId: string;
  picker: ServicePickerData;
  currencySymbol: string;
  initialTitle?: string;
  initialNotes?: string | null;
  initialItems?: PlanItemDraft[];
  planId?: string;
  expectedVersion?: number;
};

export function TreatmentPlanForm({ patientId, picker, currencySymbol, initialTitle = "", initialNotes, initialItems = [], planId, expectedVersion }: Props) {
  const t = useTranslations();
  const errorText = useErrorText();
  const locale = useLocale();
  const intl = INTL_LOCALE[isLocale(locale) ? locale : "fr"];
  const services = useMemo(() => picker.categories.flatMap((category) => category.services), [picker]);
  const action = planId && expectedVersion
    ? reviseTreatmentPlanAction.bind(null, planId, expectedVersion)
    : createTreatmentPlanAction.bind(null, patientId);
  const [state, formAction] = useActionState(action, initialActionState);
  const restored = state.values?.items ? safeItems(state.values.items) : null;
  const [items, setItems] = useState<PlanItemDraft[]>(restored ?? initialItems);
  const [selectedId, setSelectedId] = useState("");
  const selected = services.find((service) => service.id === selectedId);
  const itemsError = errorText(state.fieldErrors?.items || state.fieldErrors?.["items.0.toothNumber"]);
  const total = items.reduce((sum, item) => {
    const service = services.find((row) => row.id === item.serviceId);
    return sum + (service?.priceMinor ?? 0) * item.quantity;
  }, 0);

  const add = () => {
    if (!selected) return;
    setItems((current) => [...current, {
      key: crypto.randomUUID(), serviceId: selected.id, quantity: 1, toothNumber: null,
      surfaces: [], arch: null, quadrant: null,
    }]);
    setSelectedId("");
  };

  const update = (key: string, patch: Partial<PlanItemDraft>) =>
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError error={state.error} />
      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <TextField label={t("treatmentPlans.fields.title")} name="title" required maxLength={160}
          defaultValue={state.values?.title ?? initialTitle} error={state.fieldErrors?.title} />
        <TextAreaField label={t("treatmentPlans.fields.notes")} name="notes" rows={3} optionalLabel maxLength={2000}
          defaultValue={state.values?.notes ?? initialNotes ?? ""} error={state.fieldErrors?.notes} />
      </section>

      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">{t("treatmentPlans.items")}</h2>
          <p className="text-sm text-muted-foreground">{t("treatmentPlans.itemsHint")}</p>
        </div>
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
          <ServiceCombobox data={picker} value={selectedId} onValueChange={setSelectedId} currencySymbol={currencySymbol} />
          <Button type="button" variant="outline" onClick={add} disabled={!selected}>
            <PlusIcon aria-hidden />{t("treatmentPlans.addItem")}
          </Button>
        </div>
        <input type="hidden" name="items" value={JSON.stringify(items.map((item) => ({
          serviceId: item.serviceId, quantity: item.quantity, toothNumber: item.toothNumber,
          surfaces: item.surfaces, arch: item.arch, quadrant: item.quadrant,
        })))} />
        {itemsError ? <p className="text-sm font-medium text-destructive">{itemsError}</p> : null}
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("treatmentPlans.emptyItems")}</div>
        ) : (
          <ol className="space-y-3">
            {items.map((item, index) => {
              const service = services.find((row) => row.id === item.serviceId);
              if (!service) return null;
              const localizedName = (service.name as Record<string, string | undefined>)[locale] || service.name.fr;
              return (
                <li key={item.key} className="rounded-xl border bg-muted/25 p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium"><bdi>{localizedName}</bdi></p>
                      <p className="text-xs text-muted-foreground"><bdi>{service.code}</bdi> · {formatMoney(service.priceMinor, service.currency, intl, currencySymbol)}</p>
                    </div>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t("treatmentPlans.removeItem")}
                      onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}>
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`qty-${item.key}`}>{t("procedures.fields.quantity")}</Label>
                      <input id={`qty-${item.key}`} type="number" min={1} max={99} inputMode="numeric" value={item.quantity}
                        onChange={(event) => update(item.key, { quantity: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
                        className="h-9 w-24 rounded-md border bg-background px-3 tabular" />
                    </div>
                    {(service.anatomy === "tooth" || service.anatomy === "surface") ? (
                      <div className="grid gap-1.5">
                        <Label htmlFor={`tooth-${item.key}`}>{t("procedures.fields.tooth")}</Label>
                        <input id={`tooth-${item.key}`} inputMode="numeric" maxLength={2} value={item.toothNumber ?? ""} placeholder="11"
                          onChange={(event) => update(item.key, { toothNumber: event.target.value || null })}
                          className="h-9 w-24 rounded-md border bg-background px-3 tabular" />
                      </div>
                    ) : null}
                  </div>
                  {service.anatomy === "surface" ? (
                    <div className="mt-3 grid gap-2">
                      <Label>{t("procedures.fields.surfaces")}</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {SURFACES.map((surface) => {
                          const active = item.surfaces.includes(surface);
                          return <Button key={surface} type="button" size="sm" variant={active ? "secondary" : "outline"} aria-pressed={active}
                            onClick={() => update(item.key, { surfaces: active ? item.surfaces.filter((x) => x !== surface) : [...item.surfaces, surface] })}>
                            {t(`procedures.surfaces.${surface}`)}
                          </Button>;
                        })}
                      </div>
                    </div>
                  ) : null}
                  {service.anatomy === "arch" ? (
                    <AnatomySelect label={t("procedures.fields.arch")} value={item.arch ?? ""} onChange={(value) => update(item.key, { arch: value || null })}
                      options={ARCHES.map((value) => ({ value, label: t(`procedures.arches.${value}`) }))} placeholder={t("procedures.choose")} />
                  ) : null}
                  {service.anatomy === "quadrant" ? (
                    <AnatomySelect label={t("procedures.fields.quadrant")} value={item.quadrant ?? ""} onChange={(value) => update(item.key, { quadrant: value || null })}
                      options={QUADRANTS.map((value) => ({ value, label: t(`procedures.quadrants.${value}`) }))} placeholder={t("procedures.choose")} />
                  ) : null}
                  <p className="mt-3 text-end text-sm font-semibold tabular">
                    {t("treatmentPlans.lineTotal")}: {formatMoney(service.priceMinor * item.quantity, service.currency, intl, currencySymbol)}
                  </p>
                  <span className="sr-only">{index + 1}</span>
                </li>
              );
            })}
          </ol>
        )}
        <div className="flex items-center justify-between rounded-xl bg-primary/8 p-4">
          <span className="font-medium">{t("treatmentPlans.estimatedTotal")}</span>
          <strong className="text-lg tabular">{formatMoney(total, services[0]?.currency ?? "DZD", intl, currencySymbol)}</strong>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <ButtonLink href={`/patients/${patientId}?tab=treatments`} variant="outline">{t("common.cancel")}</ButtonLink>
        <SubmitButton disabled={items.length === 0}>{planId ? t("treatmentPlans.saveRevision") : t("treatmentPlans.create")}</SubmitButton>
      </div>
    </form>
  );
}

function AnatomySelect({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  return <div className="mt-3 grid gap-1.5"><Label>{label}</Label><NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
    <NativeSelectOption value="">{placeholder}</NativeSelectOption>
    {options.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
  </NativeSelect></div>;
}

function safeItems(value: string): PlanItemDraft[] | null {
  try {
    const parsed = JSON.parse(value) as Omit<PlanItemDraft, "key">[];
    return Array.isArray(parsed) ? parsed.map((item) => ({ ...item, key: crypto.randomUUID() })) : null;
  } catch { return null; }
}
