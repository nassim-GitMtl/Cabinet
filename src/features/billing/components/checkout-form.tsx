"use client";

import { useActionState, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileCheck2Icon } from "lucide-react";
import { FormError, SubmitButton, TextAreaField } from "@/components/form";
import { ButtonLink } from "@/components/button-link";
import { Checkbox } from "@/components/ui/checkbox";
import { initialActionState } from "@/lib/action-state";
import { formatDateOnly } from "@/lib/dates";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import type { LocalizedText } from "@/server/db/schema/_shared";
import { createInvoiceAction } from "../actions";
import { moneyFormatter } from "../format";

export type UnbilledItem = {
  id: string;
  code: string;
  name: LocalizedText;
  toothNumber: string | null;
  quantity: number;
  amountMinor: number;
  currency: string;
  serviceDate: string;
  provider: string;
};

export function CheckoutForm({
  patientId,
  items,
  symbol,
  canIssue,
}: {
  patientId: string;
  items: UnbilledItem[];
  symbol: string;
  canIssue: boolean;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const locale = useLocale();
  const money = moneyFormatter(INTL_LOCALE[isLocale(locale) ? locale : "fr"], symbol);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [state, action] = useActionState(createInvoiceAction.bind(null, patientId), initialActionState);
  const currency = items[0]?.currency ?? "DZD";
  const total = useMemo(() => items.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.amountMinor, 0), [items, selected]);
  const nameOf = (n: LocalizedText) => (n as Record<string, string | undefined>)[locale] || n.fr;
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <form action={action} className="space-y-4">
      <FormError error={state.error} />
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-start gap-3 p-4 active:bg-accent">
              <Checkbox
                name="procedureIds"
                value={i.id}
                checked={selected.has(i.id)}
                onCheckedChange={(v) => toggle(i.id, Boolean(v))}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  <bdi>{nameOf(i.name)}</bdi>
                  {i.toothNumber ? <span className="text-muted-foreground"> · {t("tooth")} {i.toothNumber}</span> : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatDateOnly(i.serviceDate)} · <bdi>{i.provider}</bdi>
                  {i.quantity > 1 ? ` · ${t("qty")} ${i.quantity}` : ""}
                </span>
              </span>
              <span className="font-semibold tabular">{money(i.amountMinor, i.currency)}</span>
            </label>
          </li>
        ))}
      </ul>
      <TextAreaField label={t("notes")} name="notes" optionalLabel rows={2} />
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 space-y-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:bg-card sm:p-4 lg:bottom-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">{t("selected", { count: selected.size })}</span>
          <span className="text-xl font-semibold tabular">{money(total, currency)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {canIssue ? (
            <SubmitButton name="mode" value="issue" size="lg" className="flex-1 sm:flex-none" disabled={selected.size === 0}>
              <FileCheck2Icon aria-hidden />
              {t("issueNow")}
            </SubmitButton>
          ) : null}
          <SubmitButton name="mode" value="draft" size="lg" variant={canIssue ? "outline" : "default"} disabled={selected.size === 0}>
            {t("saveDraft")}
          </SubmitButton>
          <ButtonLink href={`/patients/${patientId}?tab=finance`} variant="ghost" size="lg">
            {tc("cancel")}
          </ButtonLink>
        </div>
      </div>
    </form>
  );
}
