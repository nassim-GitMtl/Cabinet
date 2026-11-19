import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { PublishQuestionnaireButton, QuestionnaireEditor } from "@/features/health/components/questionnaire-editor";
import { listQuestionnaireVersions } from "@/features/health/server";
import { formatDateTime } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("health.editor"))("title") }; }

export default async function QuestionnaireSettingsPage() {
  const ctx = await requireClinicContext(); const t = await getTranslations("health.editor");
  if (!can(ctx, "questionnaire.manage") && !can(ctx, "questionnaire.approve")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const versions = await listQuestionnaireVersions(ctx); const current = versions.find((version) => version.isCurrent)!;
  return <>
    <PageHeader title={t("title")} description={t("subtitle")} back={<Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4 rtl:rotate-180" />{t("back")}</Link>} />
    <section className="mb-5 overflow-hidden rounded-2xl border bg-card shadow-sm"><div className="border-b px-4 py-3"><h2 className="font-semibold">{t("versions")}</h2><p className="text-sm text-muted-foreground">{t("versionsHint")}</p></div><ul className="divide-y">{versions.map((version) => <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{t("version", { number: version.versionNo })} · <bdi>{version.title.fr}</bdi></p><p className="text-xs text-muted-foreground">{t("questionCount", { count: version.questions.length })} · {formatDateTime(version.createdAt, ctx.organization.timezone)}</p></div><div className="flex items-center gap-2">{version.isCurrent ? <Badge>{t("current")}</Badge> : version.approvedAt ? <Badge variant="secondary">{t("previous")}</Badge> : <Badge variant="outline">{t("draft")}</Badge>}{!version.approvedAt && can(ctx, "questionnaire.approve") ? <PublishQuestionnaireButton versionId={version.id} /> : null}</div></li>)}</ul></section>
    {can(ctx, "questionnaire.manage") ? <QuestionnaireEditor title={current.title} questions={current.questions} /> : null}
  </>;
}
