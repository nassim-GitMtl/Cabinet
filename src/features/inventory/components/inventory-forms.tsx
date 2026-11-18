"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownToLineIcon, PackagePlusIcon, PackageMinusIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { initialActionState } from "@/lib/action-state";
import { consumeInventoryAction, createInventoryItemAction, receiveInventoryAction } from "../actions";
import { inventoryUnits } from "../schemas";

type Option = { id: string; label: string };

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border bg-card shadow-sm open:ring-1 open:ring-primary/10">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</span>
        {title}
        <span className="ms-auto text-muted-foreground transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="border-t p-4">{children}</div>
    </details>
  );
}

export function InventoryForms({ items, branches, today }: { items: Option[]; branches: Option[]; today: string }) {
  const t = useTranslations("inventory");
  const [itemState, itemAction] = useActionState(createInventoryItemAction, initialActionState);
  const [receiveState, receiveAction] = useActionState(receiveInventoryAction, initialActionState);
  const [consumeState, consumeAction] = useActionState(consumeInventoryAction, initialActionState);
  const itemOptions = items.map((item) => ({ value: item.id, label: item.label }));
  const branchOptions = branches.map((branch) => ({ value: branch.id, label: branch.label }));
  const units = inventoryUnits.map((unit) => ({ value: unit, label: t(`units.${unit}`) }));

  return (
    <section className="mb-5 grid gap-3 xl:grid-cols-3" aria-label={t("title")}>
      <Card title={t("createItem")} icon={<PackagePlusIcon className="size-5" aria-hidden />}>
        <form action={itemAction} className="grid gap-3">
          <FormError error={itemState.error} />
          <div className="grid grid-cols-2 gap-3">
            <TextField name="sku" label={t("sku")} required error={itemState.fieldErrors?.sku} defaultValue={itemState.values?.sku} />
            <SelectField name="unit" label={t("unit")} required options={units} placeholder={t("chooseUnit")} error={itemState.fieldErrors?.unit} defaultValue={itemState.values?.unit} />
          </div>
          <TextField name="name" label={t("itemName")} required error={itemState.fieldErrors?.name} defaultValue={itemState.values?.name} dir="auto" />
          <div className="grid grid-cols-2 gap-3">
            <TextField name="category" label={t("category")} optionalLabel error={itemState.fieldErrors?.category} defaultValue={itemState.values?.category} dir="auto" />
            <TextField name="minimumStock" type="number" min="0" step="1" label={t("minimumStock")} required error={itemState.fieldErrors?.minimumStock} defaultValue={itemState.values?.minimumStock ?? "0"} inputMode="numeric" />
          </div>
          <SubmitButton>{t("createItem")}</SubmitButton>
        </form>
      </Card>

      <Card title={t("receiveStock")} icon={<ArrowDownToLineIcon className="size-5" aria-hidden />}>
        <form action={receiveAction} className="grid gap-3">
          <FormError error={receiveState.error} />
          <SelectField name="itemId" label={t("item")} required options={itemOptions} placeholder={t("chooseItem")} error={receiveState.fieldErrors?.itemId} defaultValue={receiveState.values?.itemId} />
          <SelectField name="branchId" label={t("branch")} required options={branchOptions} placeholder={t("chooseBranch")} error={receiveState.fieldErrors?.branchId} defaultValue={receiveState.values?.branchId} />
          <div className="grid grid-cols-2 gap-3">
            <TextField name="lotNumber" label={t("lotNumber")} required error={receiveState.fieldErrors?.lotNumber} defaultValue={receiveState.values?.lotNumber} />
            <TextField name="quantity" type="number" min="1" step="1" label={t("quantity")} required error={receiveState.fieldErrors?.quantity} defaultValue={receiveState.values?.quantity} inputMode="numeric" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField name="receivedOn" type="date" max={today} label={t("receivedOn")} required error={receiveState.fieldErrors?.receivedOn} defaultValue={receiveState.values?.receivedOn ?? today} />
            <TextField name="expiresOn" type="date" label={t("expiresOn")} optionalLabel error={receiveState.fieldErrors?.expiresOn} defaultValue={receiveState.values?.expiresOn} />
          </div>
          <TextField name="reference" label={t("reference")} optionalLabel error={receiveState.fieldErrors?.reference} defaultValue={receiveState.values?.reference} dir="auto" />
          <SubmitButton disabled={!items.length || !branches.length}>{t("recordReceipt")}</SubmitButton>
        </form>
      </Card>

      <Card title={t("consumeStock")} icon={<PackageMinusIcon className="size-5" aria-hidden />}>
        <form action={consumeAction} className="grid gap-3">
          <FormError error={consumeState.error} />
          <p className="text-sm text-muted-foreground">{t("fefoHint")}</p>
          <SelectField name="itemId" label={t("item")} required options={itemOptions} placeholder={t("chooseItem")} error={consumeState.fieldErrors?.itemId} defaultValue={consumeState.values?.itemId} />
          <SelectField name="branchId" label={t("branch")} required options={branchOptions} placeholder={t("chooseBranch")} error={consumeState.fieldErrors?.branchId} defaultValue={consumeState.values?.branchId} />
          <TextField name="quantity" type="number" min="1" step="1" label={t("quantity")} required error={consumeState.fieldErrors?.quantity} defaultValue={consumeState.values?.quantity} inputMode="numeric" />
          <TextField name="reference" label={t("usageReference")} optionalLabel error={consumeState.fieldErrors?.reference} defaultValue={consumeState.values?.reference} dir="auto" />
          <SubmitButton disabled={!items.length || !branches.length}>{t("recordUsage")}</SubmitButton>
        </form>
      </Card>
    </section>
  );
}
