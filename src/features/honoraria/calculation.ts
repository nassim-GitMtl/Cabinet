import { applyBasisPoints } from "@/lib/money";

/** percent: basis points (3000 = 30%) of the fee base · fixed: minor units per unit of quantity. */
export type FeeRule = { type: "percent" | "fixed"; value: number };

export function isValidRule(rule: FeeRule): boolean {
  if (!Number.isSafeInteger(rule.value) || rule.value < 0) return false;
  return rule.type === "fixed" || rule.value <= 10_000;
}

/**
 * Which rule applies to a billed line, most specific first: the rule typed on the line at checkout, then the
 * practitioner's rule for this service, then the practitioner's default percentage.
 */
export function resolveRule(lineRule: FeeRule | null, serviceRule: FeeRule | null, defaultRateBp: number): FeeRule {
  return lineRule ?? serviceRule ?? { type: "percent", value: defaultRateBp };
}

/**
 * Practitioner share of one invoice line, in integer minor units, rounded once.
 * line amount = unit price x quantity - discount (tax excluded); the lab fee comes off the base only when the
 * service deducts it; the share is never negative and never more than the base; the clinic keeps the rest.
 */
export function calculateHonorarium(input: {
  unitPriceMinor: number;
  quantity: number;
  discountMinor: number;
  labFeeMinor: number;
  deductLabBeforeShare: boolean;
  rule: FeeRule;
}) {
  const lineAmountMinor = input.unitPriceMinor * input.quantity - input.discountMinor;
  const baseMinor = Math.max(0, lineAmountMinor - (input.deductLabBeforeShare ? input.labFeeMinor : 0));
  const raw = input.rule.type === "percent" ? applyBasisPoints(baseMinor, input.rule.value) : input.rule.value * input.quantity;
  const physicianShareMinor = Math.min(baseMinor, Math.max(0, raw));
  return { lineAmountMinor, baseMinor, physicianShareMinor, clinicShareMinor: lineAmountMinor - physicianShareMinor };
}

/** "30", "30.5" or "30,5" (percent) -> basis points; null when not a percentage between 0 and 100. */
export function percentInputToBasisPoints(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10_000 ? bp : null;
}
