import "server-only";
import { toCsv } from "@/lib/export/csv";
import type { ExportSheet } from "@/lib/export/table";
import { toXlsx } from "@/lib/export/xlsx";
import { audit } from "@/server/audit";
import { tenantTx, type ClinicContext } from "@/server/auth/context";

/** Sends sheets as .xlsx (all sheets) or .csv (one sheet) and logs the export (no data in the log). */
export async function sendExport(
  ctx: ClinicContext,
  opts: { sheets: ExportSheet[]; format: string; sheetIndex: number; fileBase: string; kind: string; filters: Record<string, string> },
) {
  await tenantTx(ctx, (tx) =>
    audit(tx, {
      organizationId: ctx.organizationId,
      actorType: "staff",
      actorUserId: ctx.userId,
      action: "report.exported",
      entityType: "report",
      entityId: opts.kind,
      metadata: { format: opts.format, ...opts.filters },
    }),
  );
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (opts.format === "csv") {
    const sheet = opts.sheets[Math.min(Math.max(opts.sheetIndex, 0), opts.sheets.length - 1)]!;
    return new Response(toCsv(sheet), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${opts.fileBase}.csv"` },
    });
  }
  return new Response(Buffer.from(toXlsx(opts.sheets)), {
    headers: {
      ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${opts.fileBase}.xlsx"`,
    },
  });
}

export function forbidden() {
  return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}
