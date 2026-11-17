import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BookOpenIcon, ConstructionIcon, TriangleAlertIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ButtonLink } from "@/components/button-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStats } from "@/features/dashboard/server";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dashboard"))("title") };
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <Card className="h-full transition-colors hover:bg-accent/40">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular">{value}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">{body}</Link> : body;
}

export default async function DashboardPage() {
  const ctx = await requireClinicContext();
  const [t, locale, stats] = await Promise.all([getTranslations("dashboard"), getLocale(), getDashboardStats(ctx)]);
  const date = new Intl.DateTimeFormat(INTL_LOCALE[isLocale(locale) ? locale : "fr"], {
    timeZone: ctx.organization.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <>
      <PageHeader
        title={t("greeting", { name: ctx.displayName })}
        description={t("today", { date })}
        actions={
          can(ctx, "patient.create") ? (
            <ButtonLink href="/patients/new" className="hidden sm:inline-flex">
              <UserPlusIcon aria-hidden />
              {t("newPatient")}
            </ButtonLink>
          ) : null
        }
      />

      {stats.catalogStats && stats.catalogStats.demoPrices > 0 && can(ctx, "catalog.manage") ? (
        <Alert className="mb-6 border-warning/50 bg-warning/10">
          <TriangleAlertIcon className="text-warning-foreground" aria-hidden />
          <AlertTitle>{t("demoPricesTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("demoPricesBody", { count: stats.catalogStats.demoPrices })}</p>
            <ButtonLink href="/catalog" variant="outline" size="sm" className="mt-2">
              <BookOpenIcon aria-hidden />
              {t("demoPricesCta")}
            </ButtonLink>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.patientStats ? (
          <>
            <Stat label={t("patientsTotal")} value={stats.patientStats.active} href="/patients" />
            <Stat label={t("patientsNew")} value={stats.patientStats.newLast30} href="/patients" />
          </>
        ) : null}
        {stats.catalogStats ? <Stat label={t("servicesActive")} value={stats.catalogStats.active} href="/catalog" /> : null}
      </section>

      <Card className="mt-6 border-dashed">
        <CardContent className="flex gap-3 pt-6">
          <ConstructionIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-medium">{t("roadmapTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("roadmapBody")}</p>
          </div>
        </CardContent>
      </Card>

      {stats.patientStats && stats.patientStats.active === 0 && can(ctx, "patient.create") ? (
        <div className="mt-6 flex justify-center">
          <ButtonLink href="/patients/new" size="lg">
            <UsersIcon aria-hidden />
            {t("newPatient")}
          </ButtonLink>
        </div>
      ) : null}
    </>
  );
}
