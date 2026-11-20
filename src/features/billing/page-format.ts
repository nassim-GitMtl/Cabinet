import "server-only";
import { getLocale } from "next-intl/server";
import { INTL_LOCALE, isLocale, type Locale } from "@/i18n/config";
import type { ClinicContext } from "@/server/auth/context";
import type { LocalizedText } from "@/server/db/schema/_shared";
import { moneyFormatter } from "./format";

/** Formatting helpers for server-rendered finance pages. */
export async function pageFormat(ctx: ClinicContext, localeOverride?: Locale) {
  const raw = await getLocale();
  const locale: Locale = localeOverride ?? (isLocale(raw) ? raw : "fr");
  const intl = INTL_LOCALE[locale];
  const symbol = ctx.organization.settings.currencyDisplay ?? ctx.organization.defaultCurrency;
  return {
    locale,
    intl,
    symbol,
    money: moneyFormatter(intl, symbol),
    label: (n: LocalizedText) => (n as Record<string, string | undefined>)[locale] || n.fr,
  };
}
