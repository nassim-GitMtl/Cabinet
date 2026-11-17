import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { updatePatientAction } from "@/features/patients/actions";
import { PatientForm } from "@/features/patients/components/patient-form";
import { patientDisplayName, patientFormDefaults } from "@/features/patients/display";
import { getPatient, listProviders } from "@/features/patients/server";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("patients"))("editTitle") };
}

export default async function EditPatientPage({ params }: PageProps<"/patients/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "patient.update")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const data = await getPatient(ctx, id);
  if (!data) notFound();
  const providers = await listProviders(ctx);
  return (
    <>
      <PageHeader title={t("patients.editTitle")} description={patientDisplayName(data.patient)} />
      <PatientForm
        action={updatePatientAction.bind(null, id, data.patient.version)}
        defaults={patientFormDefaults(data.patient)}
        providers={providers.map((p) => ({ id: p.id, label: [p.title, p.displayName].filter(Boolean).join(" ") }))}
        submitLabel={t("common.save")}
        cancelHref={`/patients/${id}`}
      />
    </>
  );
}
