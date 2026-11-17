import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { createPatientAction } from "@/features/patients/actions";
import { PatientForm } from "@/features/patients/components/patient-form";
import { listProviders } from "@/features/patients/server";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("patients"))("new") };
}

export default async function NewPatientPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "patient.create")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const providers = await listProviders(ctx);
  return (
    <>
      <PageHeader title={t("patients.new")} />
      <PatientForm
        action={createPatientAction}
        providers={providers.map((p) => ({ id: p.id, label: [p.title, p.displayName].filter(Boolean).join(" ") }))}
        submitLabel={t("common.create")}
        cancelHref="/patients"
      />
    </>
  );
}
