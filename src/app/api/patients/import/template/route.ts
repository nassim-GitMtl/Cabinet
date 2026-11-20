import { getTranslations } from "next-intl/server";
import { requireClinicContext } from "@/server/auth/context";

export const dynamic = "force-dynamic";

/** Ready-to-fill CSV (UTF-8 with BOM so Excel shows accents and Arabic correctly). */
export async function GET() {
  await requireClinicContext();
  const t = await getTranslations("patientImport.template");
  const header = [t("legacyNumber"), t("lastName"), t("firstName"), t("lastNameAr"), t("firstNameAr"), t("sex"), t("birthDate"), t("phone"), t("phoneAlt"), t("email"), t("address"), t("city"), t("notes")];
  const example = ["1024", "BENALI", "Lina", "بن علي", "لينا", "F", "05/03/1985", "0550 12 34 56", "", "", "", "Blida", ""];
  const csv = "﻿" + [header, example].map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";")).join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="modele-import-patients.csv"', "Cache-Control": "no-store" },
  });
}
