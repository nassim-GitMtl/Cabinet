import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "@/features/patients/import/components/import-wizard";
import { listPatientImports } from "@/features/patients/import/server";
import { formatDateTime } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("patientImport"))("title") };
}

export default async function PatientImportPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations("patientImport");
  if (!can(ctx, "patient.create")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const history = await listPatientImports(ctx);
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} back={<ButtonLink href="/patients" variant="ghost">← {(await getTranslations("patients"))("title")}</ButtonLink>} />
      <ImportWizard />
      {history.length ? (
        <section className="mt-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <h2 className="font-semibold">{t("history")}</h2>
          <ul className="mt-3 divide-y text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><bdi>{h.fileName}</bdi> <span className="text-xs text-muted-foreground">· {formatDateTime(h.createdAt, ctx.organization.timezone)}</span></span>
                <span className="text-muted-foreground">{t("historyLine", { imported: h.importedCount, duplicates: h.skippedDuplicates, invalid: h.skippedInvalid })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
