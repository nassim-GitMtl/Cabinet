import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ActivityIcon,
  ArrowLeftIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FileImageIcon,
  FilePenLineIcon,
  HeartPulseIcon,
  PackageCheckIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StethoscopeIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgendaSetup } from "@/features/agenda/server";
import { careInstructionsFor } from "@/features/follow-ups/compose";
import type { MessageLocale } from "@/features/follow-ups/messages";
import { PendingConsumptionActions } from "@/features/inventory/components/consumables";
import { NotesSection } from "@/features/notes/components/notes-section";
import { listNoteTemplates } from "@/features/notes/server";
import { patientDisplayName } from "@/features/patients/display";
import { getVisitCockpit } from "@/features/visit-cockpit/server";
import { formatDateOnly, formatDateTime, todayInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";
import type { LocalizedText } from "@/server/db/schema/_shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("visitCockpit"))("title") };
}

type VisitPageProps = { params: Promise<{ id: string }> };

function Section({
  id,
  icon,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle id={id} className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent aria-labelledby={id}>{children}</CardContent>
    </Card>
  );
}

function localName(name: LocalizedText | null, locale: string) {
  if (!name) return null;
  return name[locale as keyof LocalizedText] || name.fr;
}

function anatomy(row: { toothNumber: string | null; surfaces: string[]; arch: string | null; quadrant: string | null; quantity: number }, t: Awaited<ReturnType<typeof getTranslations>>) {
  const values: string[] = [];
  if (row.toothNumber) values.push(t("procedures.toothShort", { tooth: row.toothNumber }));
  if (row.surfaces.length) values.push(row.surfaces.map((surface) => t(`procedures.surfaces.${surface}` as never)).join(", "));
  if (row.arch) values.push(t(`procedures.arches.${row.arch}` as never));
  if (row.quadrant) values.push(t(`procedures.quadrants.${row.quadrant}` as never));
  if (row.quantity > 1) values.push(t("procedures.quantityShort", { quantity: row.quantity }));
  return values.join(" · ");
}

export default async function VisitCockpitPage({ params }: VisitPageProps) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "patient.read") || !can(ctx, "clinical.read")) {
    return <ForbiddenState message={t("errors.forbiddenPage")} />;
  }

  const today = todayInZone(ctx.organization.timezone);
  const writable = can(ctx, "clinical.write");
  const [data, noteTemplates, agenda] = await Promise.all([
    getVisitCockpit(ctx, id, today),
    writable ? listNoteTemplates(ctx) : Promise.resolve([]),
    writable ? getAgendaSetup(ctx) : Promise.resolve(null),
  ]);
  if (!data) notFound();

  const { patient } = data;
  const isOpen = patient.status !== "archived" && patient.status !== "deceased";
  const canWrite = writable && isOpen;
  const locale = await getLocale();
  const patientLocale: MessageLocale = patient.preferredLocale === "en" || patient.preferredLocale === "ar" ? patient.preferredLocale : "fr";
  const categoryIds = [...new Set(data.procedures.map((procedure) => procedure.categoryId))];
  const aftercare = careInstructionsFor(categoryIds, patientLocale, ctx.organization.settings.followUps?.aftercare);
  const unsignedNotes = data.notes.filter((note) => note.status !== "signed");
  const steps = [
    { label: t("visitCockpit.steps.safety"), done: data.alerts.length === 0, attention: data.alerts.length > 0 },
    { label: t("visitCockpit.steps.plan"), done: data.plannedItems.length === 0, attention: data.plannedItems.length > 0 },
    { label: t("visitCockpit.steps.care"), done: data.procedures.length > 0, attention: data.procedures.length === 0 },
    { label: t("visitCockpit.steps.note"), done: data.notes.some((note) => note.status === "signed"), attention: unsignedNotes.length > 0 },
    { label: t("visitCockpit.steps.trace"), done: data.procedures.length > 0 && data.pendingConsumptions.length === 0, attention: data.pendingConsumptions.length > 0 },
    { label: t("visitCockpit.steps.aftercare"), done: false, attention: data.procedures.length > 0 },
  ];

  return (
    <>
      <PageHeader
        title={t("visitCockpit.title")}
        description={t("visitCockpit.subtitle", { patient: patientDisplayName(patient), date: formatDateOnly(today) })}
        back={
          <Link href={`/patients/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
            {t("visitCockpit.back")}
          </Link>
        }
        actions={
          <>
            <Badge variant="outline" className="h-8 px-3"><bdi>{patient.patientNumber}</bdi></Badge>
            {canWrite && can(ctx, "catalog.read") ? (
              <ButtonLink href={`/patients/${id}/procedures/new`}>
                <StethoscopeIcon aria-hidden />
                {t("procedures.add")}
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {!isOpen ? (
        <div role="status" className="mb-5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
          {t("visitCockpit.readOnly", { status: t(`patients.status.${patient.status}` as never) })}
        </div>
      ) : null}

      {data.appointment ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><CalendarClockIcon aria-hidden /></span>
            <div>
              <p className="font-medium">
                {localName(data.appointment.typeName, locale) ?? t("visitCockpit.appointment")}
                {" · "}{formatDateTime(data.appointment.startsAt, ctx.organization.timezone, locale)}
              </p>
              <p className="text-sm text-muted-foreground"><bdi>{[data.appointment.providerTitle, data.appointment.providerName].filter(Boolean).join(" ")}</bdi></p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t(`agenda.confirmation.${data.appointment.confirmationStatus}` as never)}</Badge>
            <Badge>{t(`agenda.visit.${data.appointment.visitStatus}` as never)}</Badge>
          </div>
        </div>
      ) : (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-dashed bg-card/60 p-3 text-sm text-muted-foreground">
          <CalendarClockIcon className="size-4" aria-hidden />
          {t("visitCockpit.noAppointment")}
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="min-w-0 space-y-5">
          <Section
            id="visit-safety"
            icon={data.alerts.length ? <ShieldAlertIcon className="size-4" aria-hidden /> : <ShieldCheckIcon className="size-4" aria-hidden />}
            title={t("visitCockpit.safety.title")}
            description={t("visitCockpit.safety.description")}
            action={<ButtonLink href={`/patients/${id}?tab=health`} size="sm" variant="outline"><HeartPulseIcon aria-hidden />{t("visitCockpit.safety.health")}</ButtonLink>}
            className={cn(data.alerts.some((alert) => alert.severity === "critical") && "border-destructive/40")}
          >
            {data.alerts.length ? (
              <ul className="grid gap-2">
                {data.alerts.map((alert) => (
                  <li key={alert.id} className={cn("rounded-xl border p-3", alert.severity === "critical" ? "border-destructive/30 bg-destructive/5" : alert.severity === "warning" ? "border-warning/40 bg-warning/5" : "bg-muted/40")}>
                    <div className="flex items-start gap-2">
                      {alert.severity === "critical" ? <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />}
                      <div><p className="font-medium" dir="auto">{alert.label}</p>{alert.details ? <p className="mt-0.5 text-sm text-muted-foreground" dir="auto">{alert.details}</p> : null}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2Icon className="size-4" aria-hidden />{t("visitCockpit.safety.clear")}</p>}
          </Section>

          <Section
            id="visit-plan"
            icon={<ClipboardCheckIcon className="size-4" aria-hidden />}
            title={t("visitCockpit.plan.title")}
            description={t("visitCockpit.plan.description")}
            action={can(ctx, "treatment_plan.read") ? <ButtonLink href={`/patients/${id}?tab=treatments`} size="sm" variant="outline">{t("visitCockpit.plan.all")}</ButtonLink> : undefined}
          >
            {data.plannedItems.length ? (
              <ul className="divide-y">
                {data.plannedItems.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-medium"><bdi>{localName(item.serviceSnapshot.name, locale)}</bdi></p>
                      <p className="text-xs text-muted-foreground"><bdi>{item.title}</bdi>{anatomy(item, t) ? ` · ${anatomy(item, t)}` : ""}</p>
                    </div>
                    <ButtonLink href={`/patients/${id}/treatment-plans/${item.planId}`} size="sm" variant="outline">{t("visitCockpit.plan.open")}</ButtonLink>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{t("visitCockpit.plan.empty")}</p>}
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              id="visit-care"
              icon={<ActivityIcon className="size-4" aria-hidden />}
              title={t("visitCockpit.care.title")}
              description={t("visitCockpit.care.description")}
              action={canWrite && can(ctx, "catalog.read") ? <ButtonLink href={`/patients/${id}/procedures/new`} size="sm">{t("procedures.add")}</ButtonLink> : undefined}
            >
              {data.procedures.length ? (
                <ul className="space-y-2">
                  {data.procedures.map((procedure) => (
                    <li key={procedure.id} className="rounded-xl bg-muted/45 p-3">
                      <p className="font-medium"><bdi>{localName(procedure.serviceSnapshot.name, locale)}</bdi></p>
                      <p className="text-xs text-muted-foreground">{anatomy(procedure, t) || <bdi>{[procedure.providerTitle, procedure.providerName].filter(Boolean).join(" ")}</bdi>}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">{t("visitCockpit.care.empty")}</p>}
            </Section>

            <Section
              id="visit-chart"
              icon={<SparklesIcon className="size-4" aria-hidden />}
              title={t("visitCockpit.chart.title")}
              description={t("visitCockpit.chart.description")}
              action={<ButtonLink href={`/patients/${id}?tab=clinical`} size="sm" variant="outline">{t("visitCockpit.chart.open")}</ButtonLink>}
            >
              {data.currentFindings.length ? (
                <ul className="flex flex-wrap gap-2">
                  {data.currentFindings.map((finding) => (
                    <li key={finding.id} className="rounded-lg border bg-background px-2.5 py-2 text-sm">
                      <span className="font-semibold tabular" dir="ltr">{finding.toothNumber}</span>
                      <span className="ms-2 text-muted-foreground">{t(`odontogram.kinds.${finding.kind}` as never)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">{t("visitCockpit.chart.empty")}</p>}
            </Section>
          </div>

          <div id="visit-note">
            <NotesSection
              patientId={id}
              notes={data.notes}
              canWrite={canWrite}
              templates={noteTemplates.map((template) => ({ value: template.id, label: template.name, kind: template.kind }))}
              providers={(agenda?.providers ?? []).map((provider) => ({ value: provider.id, label: [provider.title, provider.displayName].filter(Boolean).join(" ") }))}
              today={today}
            />
          </div>

          <Section
            id="visit-trace"
            icon={<PackageCheckIcon className="size-4" aria-hidden />}
            title={t("visitCockpit.trace.title")}
            description={t("visitCockpit.trace.description")}
            action={can(ctx, "sterilization.manage") ? <ButtonLink href={`/patients/${id}/sterilization`} size="sm" variant="outline">{t("sterilization.patient.shortTitle")}</ButtonLink> : undefined}
          >
            {data.pendingConsumptions.length ? (
              <ul className="grid gap-3">
                {data.pendingConsumptions.map((consumption) => (
                  <li key={consumption.id} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div>
                      <p className="font-medium" dir="auto">{consumption.itemName}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("visitCockpit.trace.quantity", { quantity: consumption.quantity, unit: t(`inventory.units.${consumption.itemUnit}` as never) })}
                        {" · "}<bdi>{localName(consumption.serviceSnapshot.name, locale)}</bdi>
                      </p>
                      {consumption.note ? <p className="mt-1 text-xs text-warning-foreground" dir="auto">{consumption.note}</p> : null}
                    </div>
                    <PendingConsumptionActions id={consumption.id} />
                  </li>
                ))}
              </ul>
            ) : <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2Icon className="size-4" aria-hidden />{t("visitCockpit.trace.clear")}</p>}
          </Section>

          <Section
            id="visit-aftercare"
            icon={<SendIcon className="size-4" aria-hidden />}
            title={t("visitCockpit.aftercare.title")}
            description={t("visitCockpit.aftercare.description")}
            action={can(ctx, "patient.followup") ? <ButtonLink href={`/follow-ups?tab=afterVisit&day=${today}`} size="sm"><SendIcon aria-hidden />{t("visitCockpit.aftercare.open")}</ButtonLink> : undefined}
          >
            {data.procedures.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("visitCockpit.aftercare.noCare")}</p>
            ) : aftercare ? (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("visitCockpit.aftercare.preview", { language: t(`patients.locales.${patientLocale}` as never) })}</p>
                <p className="leading-relaxed" dir={patientLocale === "ar" ? "rtl" : "ltr"}>{aftercare}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("visitCockpit.aftercare.notConfigured")}</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{t("visitCockpit.aftercare.reviewRequired")}</p>
          </Section>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("visitCockpit.checklist.title")}</CardTitle>
              <CardDescription>{t("visitCockpit.checklist.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1.5">
                {steps.map((step, index) => (
                  <li key={step.label} className="flex items-center gap-2 rounded-lg px-2 py-2">
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", step.done ? "border-success/40 bg-success/10 text-success" : step.attention ? "border-warning/50 bg-warning/10 text-warning-foreground" : "text-muted-foreground")}>
                      {step.done ? <CheckCircle2Icon className="size-4" aria-hidden /> : index + 1}
                    </span>
                    <span className="text-sm">{step.label}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{t("visitCockpit.checklist.hint")}</p>
            </CardContent>
          </Card>

          {data.fileSummary ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileImageIcon className="size-4 text-primary" aria-hidden />{t("visitCockpit.files.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular">{data.fileSummary.count}</p>
                <p className="text-xs text-muted-foreground">{data.fileSummary.latestClinicalDate ? t("visitCockpit.files.latest", { date: formatDateOnly(data.fileSummary.latestClinicalDate) }) : t("visitCockpit.files.empty")}</p>
                <ButtonLink href={`/patients/${id}?tab=documents`} size="sm" variant="outline" className="mt-3 w-full">{t("visitCockpit.files.open")}</ButtonLink>
              </CardContent>
            </Card>
          ) : null}

          {unsignedNotes.length ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-warning-foreground"><FilePenLineIcon className="size-4" aria-hidden />{t("visitCockpit.noteAttention", { count: unsignedNotes.length })}</p>
              <Link href="#visit-note" className="mt-2 inline-block text-xs font-medium underline underline-offset-4">{t("visitCockpit.goToNote")}</Link>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
