"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { ClipboardPlusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { initialActionState } from "@/lib/action-state";
import { createPurchaseOrderAction, receivePurchaseOrderLineAction } from "../actions";

type Option = { id: string; label: string };
type DraftLine = { key: number; itemId: string; quantity: string; unitCost: string };

export function PurchaseOrderForm({ items, branches, today, currency }: { items: Option[]; branches: Option[]; today: string; currency: string }) {
  const t = useTranslations("inventory");
  const [state, action] = useActionState(createPurchaseOrderAction, initialActionState);
  const [nextKey, setNextKey] = useState(2);
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, itemId: "", quantity: "1", unitCost: "" }]);
  const options = items.map((item) => ({ value: item.id, label: item.label }));
  const branchOptions = branches.map((branch) => ({ value: branch.id, label: branch.label }));
  const serialized = JSON.stringify(lines.map(({ itemId, quantity, unitCost }) => ({ itemId, quantity, unitCost })));

  return (
    <details className="mb-5 rounded-2xl border bg-card shadow-sm open:ring-1 open:ring-primary/10">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><ClipboardPlusIcon className="size-5" aria-hidden /></span>
        <span><span className="block">{t("orders.create")}</span><span className="block text-xs font-normal text-muted-foreground">{t("orders.createHint")}</span></span>
        <span className="ms-auto text-muted-foreground">+</span>
      </summary>
      <form action={action} className="grid gap-4 border-t p-4">
        <FormError error={state.error} />
        <input type="hidden" name="lines" value={serialized} />
        {state.fieldErrors?.lines ? <p className="text-sm text-destructive">{t(state.fieldErrors.lines.replace("inventory.", ""))}</p> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <TextField name="supplierName" label={t("orders.supplier")} required defaultValue={state.values?.supplierName} error={state.fieldErrors?.supplierName} dir="auto" />
          <SelectField name="branchId" label={t("branch")} required options={branchOptions} placeholder={t("chooseBranch")} defaultValue={state.values?.branchId} error={state.fieldErrors?.branchId} />
          <TextField name="orderedOn" type="date" max={today} label={t("orders.orderedOn")} required defaultValue={state.values?.orderedOn ?? today} error={state.fieldErrors?.orderedOn} />
          <TextField name="expectedOn" type="date" label={t("orders.expectedOn")} optionalLabel defaultValue={state.values?.expectedOn} error={state.fieldErrors?.expectedOn} />
        </div>
        <div className="overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[1fr_7rem_9rem_2.5rem] gap-2 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>{t("item")}</span><span>{t("quantity")}</span><span>{t("orders.unitCost", { currency })}</span><span />
          </div>
          <div className="divide-y">
            {lines.map((line) => (
              <div key={line.key} className="grid grid-cols-[1fr_1fr_2.5rem] items-end gap-2 p-3 sm:grid-cols-[1fr_7rem_9rem_2.5rem]">
                <SelectField name={`item-${line.key}`} label={t("item")} fieldClassName="col-span-3 sm:col-span-1 sm:[&>label]:sr-only" required options={options} placeholder={t("chooseItem")} value={line.itemId} onChange={(event) => setLines((current) => current.map((row) => row.key === line.key ? { ...row, itemId: event.target.value } : row))} />
                <TextField name={`quantity-${line.key}`} label={t("quantity")} fieldClassName="sm:[&>label]:sr-only" type="number" min="1" step="1" required value={line.quantity} onChange={(event) => setLines((current) => current.map((row) => row.key === line.key ? { ...row, quantity: event.target.value } : row))} />
                <TextField name={`cost-${line.key}`} label={t("orders.unitCost", { currency })} fieldClassName="sm:[&>label]:sr-only" inputMode="decimal" value={line.unitCost} onChange={(event) => setLines((current) => current.map((row) => row.key === line.key ? { ...row, unitCost: event.target.value } : row))} />
                <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} aria-label={t("orders.removeLine")} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}><Trash2Icon aria-hidden /></Button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => { setLines((current) => [...current, { key: nextKey, itemId: "", quantity: "1", unitCost: "" }]); setNextKey((value) => value + 1); }}><PlusIcon aria-hidden />{t("orders.addLine")}</Button>
          <div className="ms-auto"><SubmitButton disabled={!items.length || !branches.length}>{t("orders.create")}</SubmitButton></div>
        </div>
        <TextField name="notes" label={t("orders.notes")} optionalLabel defaultValue={state.values?.notes} error={state.fieldErrors?.notes} dir="auto" />
      </form>
    </details>
  );
}

export function PurchaseOrderReceiptForm({ lineId, remaining, today }: { lineId: string; remaining: number; today: string }) {
  const t = useTranslations("inventory");
  const [state, action] = useActionState(receivePurchaseOrderLineAction, initialActionState);
  return (
    <details className="mt-2 rounded-lg border bg-background">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-primary [&::-webkit-details-marker]:hidden">{t("orders.receiveRemaining", { count: remaining })}</summary>
      <form action={action} className="grid gap-2 border-t p-3 sm:grid-cols-2 xl:grid-cols-5">
        <input type="hidden" name="lineId" value={lineId} />
        <div className="sm:col-span-2 xl:col-span-5"><FormError error={state.error} /></div>
        <TextField name="lotNumber" label={t("lotNumber")} required defaultValue={state.values?.lotNumber} error={state.fieldErrors?.lotNumber} />
        <TextField name="quantity" label={t("quantity")} type="number" min="1" max={remaining} step="1" required defaultValue={state.values?.quantity ?? String(remaining)} error={state.fieldErrors?.quantity} />
        <TextField name="receivedOn" label={t("receivedOn")} type="date" max={today} required defaultValue={state.values?.receivedOn ?? today} error={state.fieldErrors?.receivedOn} />
        <TextField name="expiresOn" label={t("expiresOn")} type="date" optionalLabel defaultValue={state.values?.expiresOn} error={state.fieldErrors?.expiresOn} />
        <div className="self-end"><SubmitButton>{t("recordReceipt")}</SubmitButton></div>
        <div className="sm:col-span-2 xl:col-span-5"><TextField name="reference" label={t("reference")} optionalLabel defaultValue={state.values?.reference} error={state.fieldErrors?.reference} dir="auto" /></div>
      </form>
    </details>
  );
}
