import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, ShieldAlertIcon } from "lucide-react";
import { ForbiddenState } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getServicePickerData } from "@/features/catalog/server";
import { patientArabicName, patientDisplayName } from "@/features/patients/display";
import { getPatient } from "@/features/patients/server";
import { ProcedureEntryForm } from "@/features/procedures/components/procedure-entry-form";
import { getProcedureEntrySupport } from "@/features/procedures/server";
import { todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("procedures"))("addTitle") };
}

export default async function NewProcedurePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "patient.read") || !can(ctx, "clinical.write") || !can(ctx, "catalog.read")) {
    return <ForbiddenState message={t("errors.forbiddenPage")} />;
  }

  const [patientData, picker, support] = await Promise.all([
    getPatient(ctx, id),
    getServicePickerData(ctx),
    getProcedureEntrySupport(ctx),
  ]);
  if (!patientData) notFound();
  const { patient, alerts } = patientData;
  const arabic = patientArabicName(patient);
  const providers = support.providers.map((provider) => ({
    id: provider.id,
    name: [provider.title, provider.displayName].filter(Boolean).join(" "),
  }));
  const defaultProviderId =
    providers.find((provider) => provider.id === patient.assignedProviderId)?.id ??
    providers.find((provider) => provider.id === ctx.membershipId)?.id ??
    providers[0]?.id ??
    "";
  const unavailable = patient.status === "archived" || patient.status === "deceased";
  const hasServices = picker.categories.some((category) => category.services.length > 0);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/patients/${patient.id}?tab=clinical`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("procedures.backToPatient")}
      </Link>

      <header className="mb-5 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{t("procedures.patientLabel")}</p>
            <h1 className="truncate text-xl font-semibold tracking-tight">
              <bdi>{patientDisplayName(patient)}</bdi>
            </h1>
            {arabic ? (
              <p>
                <bdi lang="ar">{arabic}</bdi>
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground tabular">{patient.patientNumber}</p>
          </div>
          {patient.status !== "active" ? (
            <Badge variant="secondary">{t(`patients.status.${patient.status}`)}</Badge>
          ) : null}
        </div>
        {alerts.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5 border-t pt-3" aria-label={t("patients.alerts")}>
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs font-medium"
              >
                <ShieldAlertIcon className="size-3.5 text-destructive" aria-hidden />
                <bdi>{alert.label}</bdi>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="mb-5">
        <h2 className="text-lg font-semibold">{t("procedures.addTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("procedures.addSubtitle")}</p>
      </div>

      {unavailable ? (
        <Alert variant="destructive">
          <AlertTitle>{t("procedures.unavailableTitle")}</AlertTitle>
          <AlertDescription>{t("procedures.unavailablePatient")}</AlertDescription>
        </Alert>
      ) : !support.branches.length || !providers.length || !hasServices ? (
        <Alert>
          <AlertTitle>{t("procedures.setupRequiredTitle")}</AlertTitle>
          <AlertDescription>{
            !support.branches.length
              ? t("procedures.noBranch")
              : !providers.length
                ? t("procedures.noProvider")
                : t("procedures.noServices")
          }</AlertDescription>
          {can(ctx, "catalog.manage") && !hasServices ? (
            <ButtonLink href="/catalog" variant="outline" className="mt-3">
              {t("procedures.openCatalog")}
            </ButtonLink>
          ) : null}
        </Alert>
      ) : (
        <ProcedureEntryForm
          patientId={patient.id}
          picker={picker}
          providers={providers}
          providerPrices={support.providerPrices}
          branches={support.branches}
          defaultProviderId={defaultProviderId}
          defaultBranchId={support.branches.find((b) => b.id === ctx.siteId)?.id ?? support.branches[0]!.id}
          defaultServiceDate={todayInZone(ctx.organization.timezone)}
          currencySymbol={ctx.organization.settings.currencyDisplay ?? ctx.organization.defaultCurrency}
          canOverridePrice={can(ctx, "price.override")}
        />
      )}
    </div>
  );
}
