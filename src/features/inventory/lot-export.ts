import type { ExportSheet } from "@/lib/export/table";
import { formatPhone } from "@/lib/phone";
import type { getLotTrace } from "./consumables";

type Trace = NonNullable<Awaited<ReturnType<typeof getLotTrace>>>;
type Localized = { fr: string; en?: string; ar?: string };

/** Recall list: one row per procedure that consumed stock from the lot. */
export function lotTraceSheet(trace: Trace, t: (key: string) => string, name: (n: Localized) => string): ExportSheet {
  return {
    name: t("inventory.lot.sheetName"),
    columns: [
      { header: t("inventory.lot.patientNumber"), kind: "text" },
      { header: t("inventory.lot.patient"), kind: "text" },
      { header: t("inventory.lot.phone"), kind: "text" },
      { header: t("inventory.lot.serviceDate"), kind: "date" },
      { header: t("inventory.lot.procedure"), kind: "text" },
      { header: t("inventory.lot.tooth"), kind: "text" },
      { header: t("inventory.lot.provider"), kind: "text" },
      { header: t("inventory.quantity"), kind: "number" },
    ],
    rows: trace.patients.map((p) => [
      p.patientNumber,
      `${p.lastName.toUpperCase()} ${p.firstName}`,
      p.phone ? formatPhone(p.phone) : "",
      p.serviceDate,
      name(p.serviceSnapshot.name),
      p.toothNumber ?? "",
      p.providerName,
      -p.quantity,
    ]),
  };
}
