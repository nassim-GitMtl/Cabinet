import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { QuestionnaireForm } from "@/features/health/components/health-ui";
import { getHealthHistory } from "@/features/health/server";
import { patientDisplayName } from "@/features/patients/display";
import { getPatient } from "@/features/patients/server";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("health"))("formTitle") };
}

export default async function HealthFormPage({ params }: PageProps<"/patients/[id]/health/new">) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations("health");
  if (!can(ctx, "clinical.write")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const data = await getPatient(ctx, id);
  if (!data) notFound();
  const [h, locale] = await Promise.all([getHealthHistory(ctx, id), getLocale()]);
  return (
    <>
      <Link href={`/patients/${id}?tab=health`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        <bdi>{patientDisplayName(data.patient)}</bdi>
      </Link>
      <PageHeader title={t("formTitle")} />
      <QuestionnaireForm patientId={id} questions={h.version.questions} previous={h.latest?.answers ?? {}} locale={locale} />
    </>
  );
}
