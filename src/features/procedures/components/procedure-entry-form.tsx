"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { InfoIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import {
  FormError,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  useErrorText,
} from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ServicePickerData } from "@/features/catalog/server";
import { ServiceCombobox } from "@/features/catalog/components/service-combobox";
import { initialActionState } from "@/lib/action-state";
import { minorToInput, parseMoneyInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { recordPerformedProcedureAction } from "../actions";
import { ARCHES, QUADRANTS, SURFACES } from "../schemas";

type Option = { id: string; name: string };

type Props = {
  patientId: string;
  picker: ServicePickerData;
  providers: Option[];
  branches: Option[];
  defaultProviderId: string;
  defaultBranchId: string;
  defaultServiceDate: string;
  currencySymbol: string;
  canOverridePrice: boolean;
};

export function ProcedureEntryForm({
  patientId,
  picker,
  providers,
  branches,
  defaultProviderId,
  defaultBranchId,
  defaultServiceDate,
  currencySymbol,
  canOverridePrice,
}: Props) {
  const t = useTranslations("procedures");
  const errorText = useErrorText();
  const services = picker.categories.flatMap((category) => category.services);
  const [state, action] = useActionState(
    recordPerformedProcedureAction.bind(null, patientId),
    initialActionState,
  );
  const initialServiceId = state.values?.serviceId ?? "";
  const initialService = services.find((service) => service.id === initialServiceId) ?? null;
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [price, setPrice] = useState(
    state.values?.price ??
      (initialService ? minorToInput(initialService.priceMinor, initialService.currency) : ""),
  );
  const [surfaces, setSurfaces] = useState<string[]>(
    state.values?.surfaces ? state.values.surfaces.split(",").filter(Boolean) : [],
  );
  const selected = services.find((service) => service.id === serviceId) ?? null;
  const fields = state.fieldErrors ?? {};
  const priceMinor = selected ? parseMoneyInput(price, selected.currency) : null;
  const priceChanged = Boolean(selected && priceMinor !== null && priceMinor !== selected.priceMinor);

  const selectService = (nextId: string) => {
    const service = services.find((item) => item.id === nextId);
    setServiceId(nextId);
    setSurfaces([]);
    setPrice(service ? minorToInput(service.priceMinor, service.currency) : "");
  };

  const surfaceError = errorText(fields.surfaces);

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError error={state.error} />
      <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
        <ServiceCombobox
          data={picker}
          value={serviceId}
          onValueChange={selectService}
          currencySymbol={currencySymbol}
          error={fields.serviceId}
        />
        {selected?.isDemoPrice ? (
          <Alert>
            <InfoIcon />
            <AlertDescription>{t("demoPriceNotice")}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("fields.serviceDate")}
            name="serviceDate"
            type="date"
            required
            max={defaultServiceDate}
            defaultValue={state.values?.serviceDate ?? defaultServiceDate}
            error={fields.serviceDate}
            className="tabular"
          />
          <SelectField
            label={t("fields.provider")}
            name="performingProviderId"
            required
            defaultValue={state.values?.performingProviderId ?? defaultProviderId}
            options={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
            error={fields.performingProviderId}
          />
          {branches.length > 1 ? (
            <SelectField
              label={t("fields.branch")}
              name="branchId"
              required
              defaultValue={state.values?.branchId ?? defaultBranchId}
              options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              error={fields.branchId}
            />
          ) : (
            <input type="hidden" name="branchId" value={defaultBranchId} />
          )}
          <TextField
            label={t("fields.quantity")}
            name="quantity"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={99}
            defaultValue={state.values?.quantity ?? "1"}
            error={fields.quantity}
            className="tabular"
          />
          <TextField
            label={t("fields.unitPrice", { currency: currencySymbol })}
            name="price"
            inputMode="decimal"
            required
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            readOnly={!canOverridePrice}
            hint={!canOverridePrice ? t("priceLockedHint") : undefined}
            error={fields.price}
            className="tabular"
          />
        </div>

        {selected?.anatomy === "tooth" || selected?.anatomy === "surface" ? (
          <TextField
            label={t("fields.tooth")}
            name="toothNumber"
            inputMode="numeric"
            required
            maxLength={2}
            placeholder="11"
            defaultValue={state.values?.toothNumber ?? ""}
            hint={t("toothHint")}
            error={fields.toothNumber}
            className="max-w-32 tabular"
          />
        ) : null}

        {selected?.anatomy === "surface" ? (
          <div className="grid gap-2">
            <Label>{t("fields.surfaces")} <span className="text-destructive">*</span></Label>
            <input type="hidden" name="surfaces" value={surfaces.join(",")} />
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("fields.surfaces")}>
              {SURFACES.map((surface) => {
                const active = surfaces.includes(surface);
                return (
                  <Button
                    key={surface}
                    type="button"
                    variant={active ? "secondary" : "outline"}
                    size="sm"
                    aria-pressed={active}
                    onClick={() =>
                      setSurfaces((current) =>
                        active ? current.filter((item) => item !== surface) : [...current, surface],
                      )
                    }
                  >
                    {t(`surfaces.${surface}`)}
                  </Button>
                );
              })}
            </div>
            {surfaceError ? <p className="text-xs font-medium text-destructive">{surfaceError}</p> : null}
          </div>
        ) : null}

        {selected?.anatomy === "arch" ? (
          <SelectField
            label={t("fields.arch")}
            name="arch"
            required
            placeholder={t("choose")}
            defaultValue={state.values?.arch ?? ""}
            options={ARCHES.map((arch) => ({ value: arch, label: t(`arches.${arch}`) }))}
            error={fields.arch}
          />
        ) : null}

        {selected?.anatomy === "quadrant" ? (
          <SelectField
            label={t("fields.quadrant")}
            name="quadrant"
            required
            placeholder={t("choose")}
            defaultValue={state.values?.quadrant ?? ""}
            options={QUADRANTS.map((quadrant) => ({ value: quadrant, label: t(`quadrants.${quadrant}`) }))}
            error={fields.quadrant}
          />
        ) : null}

        {priceChanged && canOverridePrice ? (
          <TextAreaField
            label={t("fields.overrideReason")}
            name="priceOverrideReason"
            required
            rows={3}
            defaultValue={state.values?.priceOverrideReason ?? ""}
            hint={t("overrideHint")}
            error={fields.priceOverrideReason}
          />
        ) : (
          <input type="hidden" name="priceOverrideReason" value="" />
        )}
      </section>

      <div
        className={cn(
          "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
          "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 lg:bottom-0",
        )}
      >
        <ButtonLink href={`/patients/${patientId}?tab=clinical`} variant="outline">
          {t("cancel")}
        </ButtonLink>
        <SubmitButton disabled={!selected}>{t("save")}</SubmitButton>
      </div>
    </form>
  );
}
