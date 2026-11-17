import { formatMoney } from "@/lib/money";

/** Locale-aware money formatter bound to the clinic's currency display symbol. */
export function moneyFormatter(intlLocale: string, symbol: string) {
  return (minor: number, currency: string) => formatMoney(minor, currency, intlLocale, currency === "DZD" ? symbol : currency);
}
