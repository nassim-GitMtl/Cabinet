import { getTranslations } from "next-intl/server";
import { getReceivablesAging } from "@/features/reports/aging";
import { agingSheet } from "@/features/reports/exports";
import { parseDateOnly, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";
import { forbidden, sendExport } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await requireClinicContext();
  if (!can(ctx, "report.export") || !can(ctx, "report.financial")) return forbidden();
  const sp = new URL(request.url).searchParams;
  const asOf = parseDateOnly(sp.get("asOf") ?? "") ?? todayInZone(ctx.organization.timezone);
  const [aging, t] = await Promise.all([getReceivablesAging(ctx, asOf), getTranslations()]);
  return sendExport(ctx, {
    sheets: [agingSheet(aging, (k, v) => t(k as never, v as never))],
    format: sp.get("format") === "csv" ? "csv" : "xlsx",
    sheetIndex: 0,
    fileBase: `creances-${asOf}`,
    kind: "aging",
    filters: { asOf },
  });
}
