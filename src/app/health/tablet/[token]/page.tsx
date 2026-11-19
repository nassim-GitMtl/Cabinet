import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { PatientQuestionnaireForm } from "@/features/health/components/patient-questionnaire";
import { getTabletQuestionnaire } from "@/features/health/patient";

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("health.patient"))("tabletTitle"), robots: { index: false } }; }

export default async function TabletHealthPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; const data = await getTabletQuestionnaire(token); if (!data) notFound();
  const [locale, t] = await Promise.all([getLocale(), getTranslations("health.patient")]); const title = data.title[locale] || data.title.fr;
  return <main className="min-h-dvh bg-gradient-to-b from-primary/8 via-background to-background px-4 py-6"><div className="mx-auto max-w-3xl space-y-6"><div className="flex justify-end"><LanguageSwitcher compact /></div><header className="rounded-2xl border bg-card p-5 shadow-sm"><p className="text-sm text-muted-foreground">{t("tabletTitle")}</p><h1 className="text-2xl font-semibold"><bdi>{title}</bdi></h1><p className="mt-1 text-sm"><bdi>{data.firstName} {data.lastName}</bdi> · {data.patientNumber}</p><p className="mt-2 text-xs text-muted-foreground">{t("tabletPrivacy")}</p></header><PatientQuestionnaireForm mode="tablet" reference={token} questions={data.questions} previous={{}} locale={locale} /></div></main>;
}
