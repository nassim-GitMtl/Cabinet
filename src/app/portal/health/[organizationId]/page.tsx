import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { PatientQuestionnaireForm } from "@/features/health/components/patient-questionnaire";
import { getPortalHealthQuestionnaire } from "@/features/health/patient";
import { requirePatientSession } from "@/server/portal/session";

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("health.patient"))("portalTitle"), robots: { index: false } }; }

export default async function PortalHealthPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params; const ctx = await requirePatientSession();
  const [data, locale, t] = await Promise.all([getPortalHealthQuestionnaire(ctx, organizationId), getLocale(), getTranslations("health.patient")]);
  if (!data) notFound(); const title = data.version.title[locale as "fr" | "en" | "ar"] || data.version.title.fr;
  return <div className="space-y-6"><Link href="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4 rtl:rotate-180" />{t("backPortal")}</Link><header><p className="text-sm text-muted-foreground"><bdi>{data.organizationName}</bdi></p><h1 className="text-2xl font-semibold"><bdi>{title}</bdi></h1><p className="mt-1 text-sm text-muted-foreground">{t("portalDescription")}</p></header><PatientQuestionnaireForm mode="portal" reference={organizationId} questions={data.version.questions} previous={data.previous} locale={locale} /></div>;
}
