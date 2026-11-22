import { getLocale, getTranslations } from "next-intl/server";
import { canSeeHonoraria, getHonorariumReport } from "@/features/honoraria/server";
import { isLocale } from "@/i18n/config";
import { parseDateOnly, todayInZone } from "@/lib/dates";
import { minorToDecimal } from "@/lib/export/table";
import { currencyExponent } from "@/lib/money";
import { can, requireClinicContext } from "@/server/auth/context";
import { forbidden, sendExport } from "../_shared";

export const dynamic = "force-dynamic";

/** Practitioner fees for a period: details (sheet 1) and per practitioner (sheet 2). XLSX by default, CSV = details. */
export async function GET(request: Request) {
  const ctx = await requireClinicContext();
  if (!can(ctx, "report.export") || !canSeeHonoraria(ctx)) return forbidden();
  const sp = new URL(request.url).searchParams;
  const today = todayInZone(ctx.organization.timezone);
  const from = parseDateOnly(sp.get("from") ?? "") ?? `${today.slice(0, 7)}-01`;
  const to = parseDateOnly(sp.get("to") ?? "") ?? today;
  const providerId = sp.get("providerId");
  const [report, t, locale] = await Promise.all([
    getHonorariumReport(ctx, { providerId: providerId && /^[0-9a-f-]{36}$/i.test(providerId) ? providerId : null, from: from <= to ? from : to, to: from <= to ? to : from }),
    getTranslations("honoraria"),
    getLocale(),
  ]);
  const label = (name: { fr: string; en?: string; ar?: string }) => (isLocale(locale) ? name[locale] : undefined) || name.fr;
  const moneyExponent = currencyExponent(ctx.organization.defaultCurrency);
  const kindLabel = (kind: string) => (kind === "adjustment" ? t("adjustment") : kind === "backfill" ? t("assigned") : "");
  return sendExport(ctx, {
    format: sp.get("format") === "csv" ? "csv" : "xlsx",
    sheetIndex: 0,
    fileBase: `honoraires-${report.from}-${report.to}`,
    kind: "honoraria",
    filters: { from: report.from, to: report.to, ...(report.providerId ? { providerId: report.providerId } : {}) },
    sheets: [
      {
        name: t("details"),
        moneyExponent,
        columns: [
          { header: t("date"), kind: "date" },
          { header: t("doctor"), kind: "text" },
          { header: t("patient"), kind: "text" },
          { header: t("invoice"), kind: "text" },
          { header: t("service"), kind: "text" },
          { header: t("export.kind"), kind: "text" },
          { header: t("lineAmount"), kind: "money" },
          { header: t("export.labFee"), kind: "money" },
          { header: t("export.base"), kind: "money" },
          { header: t("rule"), kind: "text" },
          { header: t("export.shareBeforeCredits"), kind: "money" },
          { header: t("share"), kind: "money" },
          { header: t("cards.payable"), kind: "money" },
          { header: t("clinicShare"), kind: "money" },
          { header: t("export.reason"), kind: "text" },
        ],
        rows: report.rows.map((r) => [
          r.effectiveDate,
          r.providerSnapshot.displayName,
          `${r.patientName} (${r.patientNumber})`,
          r.invoiceNumber,
          `${r.serviceSnapshot.code} ${label(r.serviceSnapshot.name)}`,
          kindLabel(r.kind),
          r.lineAmountMinor,
          r.labFeeMinor,
          r.baseMinor,
          r.ruleType === "percent" ? `${r.ruleValue / 100} %` : t("export.fixedRule", { amount: minorToDecimal(r.ruleValue, moneyExponent) }),
          r.physicianShareMinor,
          r.earnedMinor,
          r.payableMinor,
          r.clinicShareMinor,
          r.reason ?? "",
        ]),
      },
      {
        name: t("byDoctor"),
        moneyExponent,
        columns: [
          { header: t("doctor"), kind: "text" },
          { header: t("acts"), kind: "number" },
          { header: t("cards.produced"), kind: "money" },
          { header: t("cards.earned"), kind: "money" },
          { header: t("cards.payable"), kind: "money" },
          { header: t("paidInPeriod"), kind: "money" },
          { header: t("awaitingPatient"), kind: "money" },
          { header: t("cards.balance"), kind: "money" },
        ],
        rows: report.summary.map((s) => [s.name, s.lines, s.producedMinor, s.earnedMinor, s.payableMinor, s.paidMinor, s.awaitingPatientMinor, s.balanceMinor]),
      },
    ],
  });
}
