import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, ForbiddenState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { AppointmentCard, EmptyAgenda, type AppointmentViewItem } from "@/features/agenda/components/agenda-ui";
import { listAppointments } from "@/features/agenda/server";
import { addDays, timeInZone, todayInZone, zonedToUtc } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("agenda"))("receptionTitle") };
}

export default async function ReceptionPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations("agenda");
  if (!can(ctx, "appointment.read")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const date = todayInZone(ctx.organization.timezone);
  const from = zonedToUtc(date, "00:00", ctx.organization.timezone);
  const to = zonedToUtc(addDays(date, 1), "00:00", ctx.organization.timezone);
  const [rows, locale] = await Promise.all([listAppointments(ctx, from, to), getLocale()]);
  const language = locale === "ar" || locale === "en" ? locale : "fr";
  const items: AppointmentViewItem[] = rows.map((item) => ({
    ...item,
    patientName: `${item.firstName} ${item.lastName}`,
    providerTitle: item.providerTitle,
    chairName: item.chairName,
    typeName: item.typeName?.[language] ?? item.typeName?.fr ?? null,
    startTime: timeInZone(item.startsAt, ctx.organization.timezone),
    endTime: timeInZone(item.endsAt, ctx.organization.timezone),
    date: todayInZone(ctx.organization.timezone, item.startsAt),
    durationMin: Math.round((item.endsAt.getTime() - item.startsAt.getTime()) / 60_000),
  }));
  const active = items.filter((item) => item.visitStatus !== "completed");
  const waiting = active.filter((item) => item.visitStatus === "arrived" || item.visitStatus === "waiting").length;
  const inTreatment = active.filter((item) => item.visitStatus === "in_treatment").length;

  return (
    <>
      <PageHeader title={t("receptionTitle")} description={t("receptionHint")} />
      <div className="mb-5 flex flex-wrap gap-2">
        <Badge variant="outline">{t("scheduledCount", { count: items.length })}</Badge>
        <Badge variant="secondary">{t("waitingCount", { count: waiting })}</Badge>
        <Badge>{t("treatmentCount", { count: inTreatment })}</Badge>
      </div>
      {active.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((item) => <AppointmentCard key={item.id} item={item} canManage={can(ctx, "appointment.manage")} reception />)}
        </div>
      ) : <EmptyAgenda reception />}
    </>
  );
}
