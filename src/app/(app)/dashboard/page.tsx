import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ActivityIcon,
  BookOpenIcon,
  ClipboardCheckIcon,
  ConstructionIcon,
  StethoscopeIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/button-link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStats } from "@/features/dashboard/server";
import { SetupChecklist } from "@/features/clinic-identity/components/setup-checklist";
import { getSetupChecklist } from "@/features/clinic-identity/server";
import { formatDateOnly } from "@/lib/dates";
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
  const [t, proceduresT, locale, stats] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("procedures"),
    getLocale(),
    getDashboardStats(ctx),
  ]);
  const setup = can(ctx, "org.settings.manage") ? await getSetupChecklist(ctx) : null;
  const activeLocale = isLocale(locale) ? locale : "fr";
  const date = new Intl.DateTimeFormat(INTL_LOCALE[activeLocale], {
    timeZone: ctx.organization.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const patientName = (patient: {
    firstName: string;
    lastName: string;
    firstNameAr: string | null;
    lastNameAr: string | null;
  }) =>
    activeLocale === "ar" && (patient.firstNameAr || patient.lastNameAr)
      ? [patient.firstNameAr, patient.lastNameAr].filter(Boolean).join(" ")
      : `${patient.firstName} ${patient.lastName}`;

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

      {setup ? <SetupChecklist items={setup} /> : null}

      {stats.clinicalStats ? (
        <section className="mb-6 space-y-3" aria-labelledby="today-activity-heading">
          <div className="flex items-center gap-2">
            <ActivityIcon className="size-5 text-primary" aria-hidden />
            <h2 id="today-activity-heading" className="font-heading text-lg font-semibold">
              {t("todayActivity")}
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t("visitsToday")} value={stats.clinicalStats.visits} />
            <Stat label={t("proceduresToday")} value={stats.clinicalStats.procedures} />
            <Stat label={t("patientsSeenToday")} value={stats.clinicalStats.patients} />
          </div>
        </section>
      ) : null}

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

      <div className="grid gap-4 lg:grid-cols-2">
        {stats.recentProcedures ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <StethoscopeIcon className="size-5 text-primary" aria-hidden />
                <CardTitle>{t("recentClinicalActivity")}</CardTitle>
              </div>
              <CardDescription>{t("recentClinicalDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.recentProcedures.length > 0 ? (
                <ul className="divide-y">
                  {stats.recentProcedures.map((procedure) => {
                    const serviceName = procedure.serviceSnapshot.name[activeLocale]
                      || procedure.serviceSnapshot.name.fr;
                    const name = patientName({
                      firstName: procedure.patientFirstName,
                      lastName: procedure.patientLastName,
                      firstNameAr: procedure.patientFirstNameAr,
                      lastNameAr: procedure.patientLastNameAr,
                    });
                    return (
                      <li key={procedure.id}>
                        <Link
                          href={`/patients/${procedure.patientId}?tab=clinical`}
                          className="flex items-start justify-between gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium"><bdi>{serviceName}</bdi></span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              <bdi>{name}</bdi> · <bdi>{procedure.patientNumber}</bdi>
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {formatDateOnly(procedure.serviceDate)} · {procedure.providerTitle ? <><bdi>{procedure.providerTitle}</bdi>{" "}</> : null}<bdi>{procedure.providerName}</bdi>
                            </span>
                          </span>
                          <Badge variant={procedure.status === "completed" ? "outline" : "secondary"}>
                            {proceduresT(`status.${procedure.status}`)}
                          </Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed p-5 text-center">
                  <ClipboardCheckIcon className="mx-auto size-7 text-muted-foreground" aria-hidden />
                  <p className="mt-2 text-sm text-muted-foreground">{t("noClinicalActivity")}</p>
                  <ButtonLink href="/patients" variant="outline" size="sm" className="mt-3">
                    {t("choosePatient")}
                  </ButtonLink>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {stats.recentPatients ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <UsersIcon className="size-5 text-primary" aria-hidden />
                <CardTitle>{t("recentPatients")}</CardTitle>
              </div>
              <CardDescription>{t("recentPatientsDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.recentPatients.length > 0 ? (
                <ul className="divide-y">
                  {stats.recentPatients.map((patient) => (
                    <li key={patient.id}>
                      <Link
                        href={`/patients/${patient.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium"><bdi>{patientName(patient)}</bdi></span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            <bdi>{patient.patientNumber}</bdi>{patient.phone ? <> · <bdi dir="ltr">{patient.phone}</bdi></> : null}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat(INTL_LOCALE[activeLocale], {
                            timeZone: ctx.organization.timezone,
                            day: "2-digit",
                            month: "short",
                          }).format(patient.createdAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed p-5 text-center">
                  <UsersIcon className="mx-auto size-7 text-muted-foreground" aria-hidden />
                  <p className="mt-2 text-sm text-muted-foreground">{t("noRecentPatients")}</p>
                  {can(ctx, "patient.create") ? (
                    <ButtonLink href="/patients/new" variant="outline" size="sm" className="mt-3">
                      {t("newPatient")}
                    </ButtonLink>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <section className="mt-6 space-y-3" aria-labelledby="clinic-overview-heading">
        <h2 id="clinic-overview-heading" className="font-heading text-lg font-semibold">
          {t("clinicOverview")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.patientStats ? (
            <>
              <Stat label={t("patientsTotal")} value={stats.patientStats.active} href="/patients" />
              <Stat label={t("patientsNew")} value={stats.patientStats.newLast30} href="/patients" />
            </>
          ) : null}
          {stats.catalogStats ? <Stat label={t("servicesActive")} value={stats.catalogStats.active} href="/catalog" /> : null}
        </div>
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
