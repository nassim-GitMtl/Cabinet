import { getLocale, getTranslations } from "next-intl/server";
import { getReport, monthPeriod } from "@/features/reports/server";
import { reportSheets } from "@/features/reports/exports";
import { isLocale } from "@/i18n/config";
import { parseDateOnly, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";
import { forbidden, sendExport } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await requireClinicContext();
  if (!can(ctx, "report.export") || (!can(ctx, "report.operational") && !can(ctx, "report.financial"))) return forbidden();
  const sp = new URL(request.url).searchParams;
  const today = todayInZone(ctx.organization.timezone);
  const monthly = sp.get("view") === "monthly";
  const date = parseDateOnly(sp.get("date") ?? "") ?? today;
  const month = monthPeriod(sp.get("month") ?? "") ? sp.get("month")! : today.slice(0, 7);
  const period = monthly ? monthPeriod(month)! : { from: date, to: date };
  const [report, t, raw] = await Promise.all([getReport(ctx, period), getTranslations(), getLocale()]);
  const locale = isLocale(raw) ? raw : "fr";
  const sheets = reportSheets(report, (k, v) => t(k as never, v as never), (n) => (n as Record<string, string | undefined>)[locale] || n.fr);
  return sendExport(ctx, {
    sheets,
    format: sp.get("format") === "csv" ? "csv" : "xlsx",
    sheetIndex: Number(sp.get("sheet") ?? 1),
    fileBase: monthly ? `rapport-mensuel-${month}` : `rapport-journalier-${date}`,
    kind: monthly ? "monthly" : "daily",
    filters: { from: period.from, to: period.to },
  });
}
