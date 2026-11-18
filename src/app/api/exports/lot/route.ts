import { getLocale, getTranslations } from "next-intl/server";
import { getLotTrace } from "@/features/inventory/consumables";
import { lotTraceSheet } from "@/features/inventory/lot-export";
import { slugForFile } from "@/lib/export/table";
import { can, requireClinicContext } from "@/server/auth/context";
import { forbidden, sendExport } from "../_shared";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const ctx = await requireClinicContext();
  if (!can(ctx, "report.export") || !can(ctx, "inventory.manage") || !can(ctx, "patient.read")) return forbidden();
  const sp = new URL(request.url).searchParams;
  const lotId = sp.get("lot") ?? "";
  if (!UUID.test(lotId)) return new Response("Not found", { status: 404 });
  const [trace, t, locale] = await Promise.all([getLotTrace(ctx, lotId), getTranslations(), getLocale()]);
  if (!trace) return new Response("Not found", { status: 404 });
  const name = (n: { fr: string; en?: string; ar?: string }) => (n as Record<string, string | undefined>)[locale] || n.fr;
  return sendExport(ctx, {
    sheets: [lotTraceSheet(trace, (k) => t(k as never), name)],
    format: sp.get("format") === "csv" ? "csv" : "xlsx",
    sheetIndex: 0,
    fileBase: `rappel-lot-${slugForFile(trace.lot.lotNumber) || "lot"}`,
    kind: "lot_trace",
    filters: { lotId },
  });
}
