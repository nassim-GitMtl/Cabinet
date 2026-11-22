"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { HandCoinsIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { parseMoneyInput } from "@/lib/money";
import { calculateHonorarium, percentInputToBasisPoints, resolveRule, type FeeRule } from "../calculation";

export type CheckoutFeeSupport = {
  enabled: boolean;
  providers: Array<{ id: string; name: string; defaultFeeRateBp: number }>;
  terms: Array<{ providerId: string; serviceId: string; ruleType: FeeRule["type"]; ruleValue: number }>;
  deductLabServiceIds: string[];
};

/**
 * Practitioner-fee details of one checkout line, folded by default: who is paid for the act, the lab fee and an
 * optional one-off rule, with a live preview of the share. Field names are read by createInvoiceAction.
 */
export function LineFeeFields({
  item,
  fees,
  disabled,
  money,
}: {
  item: { id: string; providerId: string; serviceId: string; quantity: number; amountMinor: number; currency: string };
  fees: CheckoutFeeSupport;
  disabled: boolean;
  money: (minor: number, currency: string) => string;
}) {
  const t = useTranslations("honoraria.checkout");
  const [providerId, setProviderId] = useState(item.providerId);
  const [lab, setLab] = useState("");
  const [ruleType, setRuleType] = useState<"" | FeeRule["type"]>("");
  const [ruleValue, setRuleValue] = useState("");
  const [reason, setReason] = useState("");

  const provider = fees.providers.find((p) => p.id === providerId);
  const term = fees.terms.find((x) => x.providerId === providerId && x.serviceId === item.serviceId);
  const labMinor = lab.trim() ? parseMoneyInput(lab, item.currency) : 0;
  const lineValue = ruleType === "percent" ? percentInputToBasisPoints(ruleValue) : ruleType === "fixed" ? parseMoneyInput(ruleValue, item.currency) : null;
  const lineRule = ruleType && lineValue !== null ? { type: ruleType, value: lineValue } : null;
  const rule = resolveRule(lineRule, term ? { type: term.ruleType, value: term.ruleValue } : null, provider?.defaultFeeRateBp ?? 0);
  const deduct = fees.deductLabServiceIds.includes(item.serviceId);
  const preview =
    labMinor !== null && labMinor >= 0 && labMinor <= item.amountMinor && (!ruleType || lineRule)
      ? calculateHonorarium({ unitPriceMinor: item.amountMinor / item.quantity, quantity: item.quantity, discountMinor: 0, labFeeMinor: labMinor, deductLabBeforeShare: deduct, rule })
      : null;
  const ruleLabel = rule.type === "percent" ? `${rule.value / 100} %` : t("fixedPerUnit", { amount: money(rule.value, item.currency) });

  return (
    <details className="group ms-8 mt-1 rounded-lg border border-dashed px-3 py-2 text-sm open:border-solid open:bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground">
        <HandCoinsIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {preview ? t("summary", { name: provider?.name ?? "—", share: money(preview.physicianShareMinor, item.currency), rule: ruleLabel }) : t("summaryInvalid")}
        </span>
        <span className="text-primary group-open:hidden">{t("edit")}</span>
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("paidPractitioner")}
          <NativeSelect name={`providerId:${item.id}`} value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={disabled}>
            {!provider ? <NativeSelectOption value={item.providerId}>{t("performer")}</NativeSelectOption> : null}
            {fees.providers.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {deduct ? t("labFeeDeducted") : t("labFee")}
          <Input name={`labFee:${item.id}`} value={lab} onChange={(e) => setLab(e.target.value)} inputMode="decimal" placeholder="0" disabled={disabled} className="tabular" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("rule")}
          <NativeSelect name={`ruleType:${item.id}`} value={ruleType} onChange={(e) => setRuleType(e.target.value as "" | FeeRule["type"])} disabled={disabled}>
            <NativeSelectOption value="">{t("ruleAutomatic")}</NativeSelectOption>
            <NativeSelectOption value="percent">{t("rulePercent")}</NativeSelectOption>
            <NativeSelectOption value="fixed">{t("ruleFixed")}</NativeSelectOption>
          </NativeSelect>
        </label>
        {ruleType ? (
          <>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {ruleType === "percent" ? t("valuePercent") : t("valueFixed")}
              <Input name={`ruleValue:${item.id}`} value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} inputMode="decimal" required disabled={disabled} className="tabular" />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
              {t("reason")}
              <Input name={`ruleReason:${item.id}`} value={reason} onChange={(e) => setReason(e.target.value)} required disabled={disabled} />
            </label>
          </>
        ) : null}
        <p className="text-xs text-muted-foreground sm:col-span-2" aria-live="polite">
          {preview
            ? t("preview", { base: money(preview.baseMinor, item.currency), share: money(preview.physicianShareMinor, item.currency), clinic: money(preview.clinicShareMinor, item.currency) })
            : t("summaryInvalid")}
        </p>
      </div>
    </details>
  );
}
