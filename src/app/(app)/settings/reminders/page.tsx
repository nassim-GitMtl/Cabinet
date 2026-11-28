import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckCircle2Icon, CircleAlertIcon, MessageCircleIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { AutoReminderToggle, TestReminderForm } from "@/features/reminders/components/reminder-settings";
import { getAutoReminders } from "@/features/reminders/server";
import { formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("reminders"))("title") };
}

const STATUS_STYLE: Record<string, string> = {
  queued: "text-muted-foreground",
  sent: "text-foreground",
  delivered: "text-primary",
  read: "text-primary",
  failed: "text-destructive",
};

export default async function ReminderSettingsPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "reminders.auto.manage")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const data = await getAutoReminders(ctx);
  const tz = ctx.organization.timezone;

  return (
    <>
      <PageHeader
        title={t("reminders.title")}
        description={t("reminders.subtitle")}
        back={<ButtonLink href="/settings" variant="ghost">← {t("settings.title")}</ButtonLink>}
      />
      <div className="space-y-6">
        <section className={cn("space-y-4 rounded-xl border p-5", data.enabled && data.configured ? "border-primary/30 bg-primary/5" : "bg-card")}>
          <div className="flex items-start gap-3">
            {data.enabled && data.configured ? <CheckCircle2Icon className="mt-0.5 size-5 text-primary" aria-hidden /> : <MessageCircleIcon className="mt-0.5 size-5 text-muted-foreground" aria-hidden />}
            <div className="space-y-1">
              <p className="font-medium">
                {!data.configured ? t("reminders.notConfigured") : data.enabled ? t("reminders.on") : t("reminders.off")}
              </p>
              <p className="text-sm text-muted-foreground">{t("reminders.how")}</p>
            </div>
          </div>
          {data.configured ? <AutoReminderToggle enabled={data.enabled} disabled={!data.enabled && !data.hasPhone} /> : null}
          {!data.hasPhone ? (
            <p className="flex items-center gap-2 text-sm text-amber-700">
              <CircleAlertIcon className="size-4" aria-hidden />
              {t("reminders.needPhone")}
              {can(ctx, "org.settings.manage") ? <ButtonLink href="/settings/follow-ups" variant="link" size="sm">{t("reminders.setPhone")}</ButtonLink> : null}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("reminders.phonesUsed")} {data.branches.filter((b) => b.phone).map((b) => `${b.name} : ${formatPhone(b.phone)}`).join(" · ")}
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{t("reminders.preview.title")}</h2>
          <p className="rounded-lg bg-muted/50 p-3 text-sm" dir="auto">{t("reminders.preview.text", { clinic: ctx.organization.name })}</p>
          <p className="text-xs text-muted-foreground">{t("reminders.preview.hint")}</p>
          {data.configured ? (
            <div className="border-t pt-3">
              <p className="mb-2 text-sm font-medium">{t("reminders.test.title")}</p>
              <TestReminderForm />
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="font-semibold">{t("reminders.history.title")}</h2>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(["sent", "delivered", "read", "failed"] as const).map((s) => (
                <Badge key={s} variant="outline">{t(`reminders.status.${s}`)} · {data.last30Days[s] ?? 0}</Badge>
              ))}
            </div>
          </div>
          {data.recent.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("reminders.history.empty")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.recent.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
                  <span className="min-w-0 flex-1 basis-56">
                    <bdi className="font-medium">{m.patientName}</bdi>
                    <span className="text-muted-foreground"> · {t("reminders.history.for", { date: m.params.date, time: m.params.time })}</span>
                  </span>
                  <span className={cn("font-medium", STATUS_STYLE[m.status])}>{t(`reminders.status.${m.status}`)}</span>
                  <span className="text-xs text-muted-foreground tabular">{formatDateTime(m.updatedAt, tz)}</span>
                  {m.status === "failed" && m.errorCode ? <span className="basis-full text-xs text-destructive">{t.has(`reminders.failure.${m.errorCode}` as never) ? t(`reminders.failure.${m.errorCode}` as never) : `${m.errorCode}${m.errorTitle ? ` · ${m.errorTitle}` : ""}`}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
