import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HeartPulseIcon, HistoryIcon } from "lucide-react";
import { ArrowLeftIcon, CalendarIcon, ClipboardListIcon, FileTextIcon, InfoIcon, MailIcon, PencilIcon, PhoneIcon, PlusIcon, ShieldAlertIcon, ShieldCheckIcon, TriangleAlertIcon, WalletIcon } from "lucide-react";
import { ForbiddenState } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { AlertsPanel } from "@/features/patients/components/alerts-panel";
import { ArchiveButton } from "@/features/patients/components/archive-button";
import { PatientTabs, type PatientTab } from "@/features/patients/components/patient-tabs";
import { patientAge, patientArabicName, patientDisplayName } from "@/features/patients/display";
import { getPatient } from "@/features/patients/server";
import { PatientFinance } from "@/features/billing/components/patient-finance";
import { pageFormat } from "@/features/billing/page-format";
import { getPatientAccount } from "@/features/billing/server";
import { ClinicalProcedures } from "@/features/procedures/components/clinical-procedures";
import { listPerformedProcedures } from "@/features/procedures/server";
import { listPatientAppointments } from "@/features/agenda/server";
import { TreatmentPlansPanel } from "@/features/treatment-plans/components/treatment-plans-panel";
import { listTreatmentPlans } from "@/features/treatment-plans/server";
import { ConsentPanel } from "@/features/consent/components/consent-panel";
import { getConsentOverview } from "@/features/consent/server";
import { OdontogramPanel } from "@/features/odontogram/components/odontogram-panel";
import { getOdontogram } from "@/features/odontogram/server";
import { NotesSection } from "@/features/notes/components/notes-section";
import { listNotes, listNoteTemplates } from "@/features/notes/server";
import { getAgendaSetup } from "@/features/agenda/server";
import { HealthPanel } from "@/features/health/components/health-panel";
import { healthStatus } from "@/features/health/server";
import { JourneyPanel } from "@/features/journey/components/journey-panel";
import { getPatientJourney } from "@/features/journey/server";
import { ClinicalFilesPanel } from "@/features/clinical-files/components/clinical-files-panel";
import { clinicalFilesUseDirectUpload, listClinicalFiles } from "@/features/clinical-files/server";
import { formatDateOnly, formatDateTime, todayInZone } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("patients"))("title") };
}

const TABS = ["overview", "details", "health", "clinical", "documents", "treatments", "journey", "finance"] as const;

function Info({ label, value, dir }: { label: string; value: React.ReactNode; dir?: "ltr" | "rtl" }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm" dir={dir}>
        {value || <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

export default async function PatientPage({ params, searchParams }: PageProps<"/patients/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "patient.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const data = await getPatient(ctx, id);
  if (!data) notFound();
  const { patient: p, alerts, provider, referrer, referredCount } = data;
  const tabAllowed = (x: (typeof TABS)[number]) =>
    x === "clinical" || x === "health" ? can(ctx, "clinical.read") : x === "documents" ? can(ctx, "clinical.images.read") : x === "treatments" ? can(ctx, "treatment_plan.read") : x === "journey" ? can(ctx, "patient.journey.manage") : x === "finance" ? can(ctx, "invoice.read") : true;
  const tab = TABS.find((x) => x === sp.tab && tabAllowed(x)) ?? "overview";
  const health = await healthStatus(ctx, id);
  const age = patientAge(p, ctx.organization.timezone);
  const arabic = patientArabicName(p);
  const country = ctx.organization.countryCode;
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const procedures = tab === "clinical" ? await listPerformedProcedures(ctx, p.id) : [];
  const odontogram = tab === "clinical" ? await getOdontogram(ctx, p.id) : null;
  const notes = tab === "clinical" ? await listNotes(ctx, p.id) : [];
  const noteTemplates = tab === "clinical" && can(ctx, "clinical.write") ? await listNoteTemplates(ctx) : [];
  const noteProviders = tab === "clinical" && can(ctx, "clinical.write") ? (await getAgendaSetup(ctx)).providers : [];
  const clinicalFiles = tab === "documents" ? await listClinicalFiles(ctx, p.id) : null;
  const journey = tab === "journey" ? await getPatientJourney(ctx, p.id) : null;
  const account = tab === "overview" && can(ctx, "invoice.read") ? await getPatientAccount(ctx, p.id) : null;
  const patientAppointments = tab === "overview" && can(ctx, "appointment.read") ? await listPatientAppointments(ctx, p.id) : null;
  const treatmentPlans = (tab === "overview" || tab === "treatments") && can(ctx, "treatment_plan.read") ? await listTreatmentPlans(ctx, p.id) : [];
  const consentOverview = can(ctx, "shared_profile.request") ? await getConsentOverview(ctx, p.id) : null;
  const nextAppointment = patientAppointments?.upcoming[0] ?? null;
  const fmt = account || treatmentPlans.length ? await pageFormat(ctx) : null;

  return (
    <>
      <Link href="/patients" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("patients.title")}
      </Link>

      {/* Persistent identity header */}
      <header className={cn("relative mb-5 overflow-hidden rounded-2xl border border-border/80 bg-card/90 p-4 shadow-[0_16px_34px_-30px_rgba(48,39,25,.4)] sm:p-6", criticalCount > 0 && "border-destructive/40")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="relative flex min-w-0 items-start gap-3 sm:gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground shadow-[0_8px_18px_-14px_color-mix(in_oklch,var(--primary),black_38%)] sm:size-14">
              <span aria-hidden>{p.firstName.slice(0, 1).toUpperCase()}{p.lastName.slice(0, 1).toUpperCase()}</span>
              <span className="sr-only">{patientDisplayName(p)}</span>
            </div>
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{patientDisplayName(p)}</h1>
              {p.status !== "active" ? <Badge variant="secondary">{t(`patients.status.${p.status}`)}</Badge> : null}
            </div>
            {arabic ? (
              <p className="text-base">
                <bdi lang="ar">{arabic}</bdi>
              </p>
            ) : null}
            <p className="mt-1 text-sm text-muted-foreground tabular">
              {p.patientNumber}
              {age ? ` · ${t(age.approximate ? "patients.ageApprox" : "patients.age", { age: age.age })}` : ""}
              {p.birthDate ? ` · ${formatDateOnly(p.birthDate)}` : ""}
              {provider ? ` · ${[provider.title, provider.displayName].filter(Boolean).join(" ")}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent" dir="ltr">
                  <PhoneIcon className="size-3.5" aria-hidden />
                  {formatPhone(p.phone, country)}
                </a>
              ) : null}
              {p.email ? (
                <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent">
                  <MailIcon className="size-3.5" aria-hidden />
                  {p.email}
                </a>
              ) : null}
            </div>
            </div>
          </div>
          <div className="relative flex flex-wrap gap-2">
            {can(ctx, "clinical.write") && can(ctx, "catalog.read") && p.status !== "archived" && p.status !== "deceased" ? (
              <ButtonLink href={`/patients/${p.id}/procedures/new`}>
                <PlusIcon aria-hidden />
                {t("procedures.add")}
              </ButtonLink>
            ) : null}
            {can(ctx, "invoice.create") ? (
              <ButtonLink href={`/patients/${p.id}/billing/new`} variant="outline">
                <FileTextIcon aria-hidden />
                {t("billing.bill")}
              </ButtonLink>
            ) : null}
            {can(ctx, "patient.update") ? (
              <ButtonLink href={`/patients/${p.id}/edit`} variant="outline">
                <PencilIcon aria-hidden />
                {t("common.edit")}
              </ButtonLink>
            ) : null}
            {can(ctx, "sterilization.manage") ? (
              <ButtonLink href={`/patients/${p.id}/sterilization`} variant="outline">
                <ShieldCheckIcon aria-hidden />
                {t("sterilization.patient.shortTitle")}
              </ButtonLink>
            ) : null}
            {can(ctx, "audit.read") ? (
              <ButtonLink href={`/settings/activity?patient=${p.id}&from=${p.createdAt.toISOString().slice(0, 10)}`} variant="ghost">
                <HistoryIcon aria-hidden />
                {t("activity.patientHistory")}
              </ButtonLink>
            ) : null}
            {can(ctx, "patient.archive") ? <ArchiveButton patientId={p.id} archived={p.status === "archived"} /> : null}
          </div>
        </div>
        {health === "none" || health === "pending_review" ? (
          <Link href={`/patients/${p.id}?tab=health`} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-xs font-medium text-warning-foreground">
            <HeartPulseIcon className="size-3.5" aria-hidden />
            {t(health === "none" ? "health.headerNone" : "health.headerPending")}
          </Link>
        ) : null}
        {alerts.length > 0 ? (
          <ul aria-label={t("patients.alerts")} className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
            {alerts.map((a) => {
              const Icon = a.severity === "critical" ? ShieldAlertIcon : a.severity === "warning" ? TriangleAlertIcon : InfoIcon;
              return (
                <li
                  key={a.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
                    a.severity === "critical" && "border-destructive/40 bg-destructive/10 text-destructive",
                    a.severity === "warning" && "border-warning/50 bg-warning/10 text-warning-foreground",
                    a.severity === "info" && "bg-muted",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  <span className="sr-only">{t(`patients.severity.${a.severity}`)}: </span>
                  {a.label}
                </li>
              );
            })}
          </ul>
        ) : null}
      </header>

      <PatientTabs patientId={p.id} active={tab} allowed={TABS.filter(tabAllowed) as PatientTab[]} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-4">
          {tab === "overview" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  { icon: CalendarIcon, label: "patients.overview.nextAppointment", module: "agenda", show: patientAppointments !== null },
                  { icon: ClipboardListIcon, label: "patients.overview.outstanding", module: "treatments", show: can(ctx, "treatment_plan.read") },
                  { icon: WalletIcon, label: "patients.overview.balance", module: "billing", show: account !== null },
                ] as const
              ).filter((card) => card.show).map((card) => (
                <div key={card.label} className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card/90 p-4 shadow-[0_10px_26px_-24px_rgba(48,39,25,.4)] transition hover:border-primary/20">
                  <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground"><card.icon className="size-5" aria-hidden /></div>
                  <p className="text-sm font-medium">{t(card.label)}</p>
                  {card.module === "agenda" ? (nextAppointment ? (
                    <Link
                      href={`/agenda?date=${todayInZone(ctx.organization.timezone, nextAppointment.startsAt)}`}
                      className="mt-1 block hover:underline"
                    >
                      <span className="block font-semibold tabular">
                        {formatDateTime(nextAppointment.startsAt, ctx.organization.timezone)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <bdi>{[nextAppointment.providerTitle, nextAppointment.providerName].filter(Boolean).join(" ")}</bdi>
                      </span>
                    </Link>
                  ) : (
                    <>
                      <p className="mt-1 text-xs text-muted-foreground">{t("patients.overview.noAppointment")}</p>
                      {can(ctx, "appointment.manage") && p.status !== "archived" ? (
                        <ButtonLink href={`/agenda?patient=${p.id}`} variant="outline" size="sm" className="mt-2">
                          <CalendarIcon aria-hidden />{t("patients.overview.book")}
                        </ButtonLink>
                      ) : null}
                    </>
                  )) : card.module === "billing" && account && fmt ? (
                    <Link href={`/patients/${p.id}?tab=finance`} className="mt-1 block hover:underline">
                      <span className="block text-lg font-semibold tabular">
                        {fmt.money(account.outstandingMinor, ctx.organization.defaultCurrency)}
                      </span>
                      {account.unappliedMinor > 0 ? (
                        <span className="block text-xs text-success tabular">
                          {t("billing.unappliedShort")} {fmt.money(account.unappliedMinor, ctx.organization.defaultCurrency)}
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <Link href={`/patients/${p.id}?tab=treatments`} className="mt-1 block hover:underline">
                      <span className="block text-lg font-semibold tabular">
                        {t("treatmentPlans.activeCount", { count: treatmentPlans.filter((plan) => !["completed", "cancelled"].includes(plan.status)).length })}
                      </span>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          ) : tab === "details" ? (
            <div className="space-y-4">
              <section className="rounded-xl border bg-card p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-semibold">{t("patients.sections.contact")}</h2>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Info label={t("patients.fields.phone")} value={formatPhone(p.phone, country)} dir="ltr" />
                  <Info label={t("patients.fields.phoneAlt")} value={formatPhone(p.phoneAlt, country)} dir="ltr" />
                  <Info label={t("patients.fields.email")} value={p.email} />
                  <Info label={t("patients.fields.address")} value={[p.addressLine, p.city, p.region].filter(Boolean).join(", ")} />
                  <Info label={t("patients.fields.preferredLocale")} value={t(`patients.locales.${p.preferredLocale as "fr"}`)} />
                  <Info label={t("patients.fields.sex")} value={p.sex ? t(`patients.sex.${p.sex}`) : null} />
                </dl>
              </section>
              <section className="rounded-xl border bg-card p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-semibold">{t("patients.sections.emergency")}</h2>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <Info label={t("patients.fields.emergencyName")} value={p.emergencyContact?.name} />
                  <Info label={t("patients.fields.emergencyRelationship")} value={p.emergencyContact?.relationship} />
                  <Info label={t("patients.fields.emergencyPhone")} value={formatPhone(p.emergencyContact?.phone, country)} dir="ltr" />
                </dl>
              </section>
              <section className="rounded-xl border bg-card p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-semibold">{t("patients.sections.administrative")}</h2>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Info label={t("acquisition.question")} value={p.acquisitionChannel ? t(`acquisition.channels.${p.acquisitionChannel}`) : null} />
                  <Info label={t("patients.fields.referralSource")} value={p.referralSource ? <bdi>{p.referralSource}</bdi> : null} />
                  {referrer ? (
                    <Info label={t("acquisition.referrer")} value={
                      <Link href={`/patients/${referrer.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        <bdi>{patientDisplayName(referrer)}</bdi> <span className="text-xs text-muted-foreground">({referrer.patientNumber})</span>
                      </Link>
                    } />
                  ) : null}
                  <Info label={t("patients.fields.referredBy")} value={p.referredBy ? <bdi>{p.referredBy}</bdi> : null} />
                  {p.legacyNumber ? <Info label={t("patientImport.legacyNumber")} value={<bdi>{p.legacyNumber}</bdi>} /> : null}
                  {referredCount ? <Info label={t("acquisition.referredOthers")} value={t("acquisition.report.referred", { count: referredCount })} /> : null}
                  <div className="sm:col-span-2">
                    <Info label={t("patients.fields.administrativeNotes")} value={p.administrativeNotes ? <span className="whitespace-pre-line">{p.administrativeNotes}</span> : null} />
                  </div>
                  <Info label={t("patients.registeredLabel")} value={formatDateTime(p.createdAt, ctx.organization.timezone)} />
                </dl>
              </section>
            </div>
          ) : tab === "health" ? (
            <HealthPanel ctx={ctx} patientId={p.id} editable={can(ctx, "clinical.write") && p.status !== "archived" && p.status !== "deceased"} />
          ) : tab === "journey" && journey ? (
            <JourneyPanel
              patientId={p.id}
              today={todayInZone(ctx.organization.timezone)}
              canShareImages={can(ctx, "clinical.images.read")}
              data={{
                access: journey.access ? { decision: journey.access.decision, decidedAt: journey.access.decidedAt.toISOString() } : null,
                items: journey.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body, eventDate: i.eventDate, sharedBy: i.sharedBy, withdrawnAt: i.withdrawnAt?.toISOString() ?? null, withdrawReason: i.withdrawReason, clinicalFileId: i.clinicalFileId, comparisonId: i.comparisonId })),
                progress: journey.progress.map((plan) => ({ id: plan.id, title: plan.title, steps: plan.steps.map((s) => ({ ...s, doneAt: s.doneAt?.toISOString() ?? null })) })),
                images: journey.images.map((i) => ({ id: i.id, clinicalDate: i.clinicalDate, label: i.title || t(`clinicalFiles.categories.${i.category}`) })),
                comparisons: journey.comparisons.map((c) => {
                  const before = journey.images.find((i) => i.id === c.beforeFileId);
                  const after = journey.images.find((i) => i.id === c.afterFileId);
                  return { id: c.id, beforeFileId: c.beforeFileId, afterFileId: c.afterFileId, label: `${before ? formatDateOnly(before.clinicalDate) : "?"} → ${after ? formatDateOnly(after.clinicalDate) : "?"}${after?.title ? ` · ${after.title}` : ""}` };
                }),
                plans: journey.plans.map((pl) => ({ id: pl.id, title: pl.title })),
              }}
            />
          ) : tab === "documents" && clinicalFiles ? (
            <ClinicalFilesPanel patientId={p.id} rows={clinicalFiles.files} comparisons={clinicalFiles.comparisons}
              canWrite={can(ctx, "clinical.images.write") && p.status !== "archived" && p.status !== "deceased"}
              today={todayInZone(ctx.organization.timezone)} directBlobUpload={clinicalFilesUseDirectUpload()} />
          ) : tab === "finance" ? (
            <PatientFinance ctx={ctx} patientId={p.id} canBill={can(ctx, "invoice.create")} />
          ) : tab === "treatments" ? (
            <TreatmentPlansPanel patientId={p.id} plans={treatmentPlans} canManage={can(ctx, "treatment_plan.manage") && can(ctx, "catalog.read") && p.status !== "archived" && p.status !== "deceased"}
              currencySymbol={ctx.organization.settings.currencyDisplay ?? ctx.organization.defaultCurrency} />
          ) : (
            <div className="space-y-8">
              <NotesSection
                patientId={p.id}
                notes={notes}
                canWrite={can(ctx, "clinical.write") && p.status !== "archived" && p.status !== "deceased"}
                templates={noteTemplates.map((x) => ({ value: x.id, label: x.name, kind: x.kind }))}
                providers={noteProviders.map((x) => ({ value: x.id, label: [x.title, x.displayName].filter(Boolean).join(" ") }))}
                today={todayInZone(ctx.organization.timezone)}
              />
              {odontogram ? <OdontogramPanel patientId={p.id} findings={odontogram.findings} providers={odontogram.providers}
                planItems={odontogram.planItems} procedures={odontogram.procedures}
                canWrite={can(ctx, "clinical.write") && p.status !== "archived" && p.status !== "deceased"}
                today={todayInZone(ctx.organization.timezone)} /> : null}
              <ClinicalProcedures
                patientId={p.id}
                procedures={procedures}
                canWrite={can(ctx, "clinical.write") && can(ctx, "catalog.read") && p.status !== "archived" && p.status !== "deceased"}
                currencySymbol={ctx.organization.settings.currencyDisplay ?? ctx.organization.defaultCurrency}
                created={sp.created === "1"}
              />
            </div>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-2 xl:self-start">
          {can(ctx, "patient.alerts.read") ? (
            <AlertsPanel
              patientId={p.id}
              alerts={alerts.map((a) => ({ id: a.id, kind: a.kind, severity: a.severity, label: a.label, details: a.details }))}
              canManage={can(ctx, "patient.alerts.manage")}
            />
          ) : null}
          {consentOverview ? <ConsentPanel patientId={p.id} overview={consentOverview} timezone={ctx.organization.timezone} defaultEmail={p.email} /> : null}
        </aside>
      </div>
    </>
  );
}
