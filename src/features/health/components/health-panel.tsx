import { getLocale, getTranslations } from "next-intl/server";
import { ClipboardPlusIcon, TriangleAlertIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { can, type ClinicContext } from "@/server/auth/context";
import { getHealthHistory } from "../server";
import { ApproveButton, PromoteButton, ReviewButtons } from "./health-ui";

/** "Santé" tab: latest answers, review state, changes since last review, history (server component). */
export async function HealthPanel({ ctx, patientId, editable }: { ctx: ClinicContext; patientId: string; editable: boolean }) {
  const [h, t, raw] = await Promise.all([getHealthHistory(ctx, patientId), getTranslations("health"), getLocale()]);
  const tz = ctx.organization.timezone;
  const label = (l: { fr: string; en?: string; ar?: string }) => (l as Record<string, string | undefined>)[raw] || l.fr;
  const latest = h.latest;
  const questions = latest?.questions ?? h.version.questions;
  const changed = new Set(h.changedSinceReview);

  return (
    <div className="space-y-4">
      {!h.approved ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
          <span className="flex items-center gap-2"><TriangleAlertIcon className="size-4 text-warning-foreground" aria-hidden />{t("notApproved")}</span>
          {can(ctx, "clinical.sign") && can(ctx, "org.settings.manage") ? <ApproveButton patientId={patientId} /> : null}
        </div>
      ) : null}

      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{label(h.version.title)}</h2>
            {latest ? (
              <p className="text-sm text-muted-foreground">
                {t("recordedOn", { date: formatDateTime(latest.r.recordedAt, tz) })} · {t(`sources.${latest.r.source}`)}
                {latest.recordedBy ? ` · ${latest.recordedBy}` : ""} · {latest.r.patientAcknowledged ? t("ackYes") : t("ackNo")}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            )}
            {latest ? (
              <p className="mt-1 text-sm">
                {h.latestReviewed && h.lastReview ? (
                  <Badge variant="outline" className="border-success/40 text-success">
                    {t(h.lastReview.rv.outcome === "no_changes" ? "reviewedNoChanges" : "reviewedBy", { name: h.lastReview.reviewer, date: formatDateTime(h.lastReview.rv.reviewedAt, tz) })}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-warning/60 text-warning-foreground">{t("pendingReview")}</Badge>
                )}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <ButtonLink href={`/patients/${patientId}/health/new`}>
                <ClipboardPlusIcon aria-hidden />
                {latest ? t("update") : t("fill")}
              </ButtonLink>
            ) : null}
            {can(ctx, "clinical.sign") ? <ReviewButtons patientId={patientId} latestReviewed={h.latestReviewed} hasResponse={!!latest} /> : null}
          </div>
        </div>
        {changed.size ? <p className="mt-3 rounded-lg bg-warning/10 p-2 text-sm">{t("changedSince", { count: changed.size })}</p> : null}
      </section>

      {latest ? (
        <section className="overflow-hidden rounded-xl border bg-card">
          <ul className="divide-y">
            {questions.map((q) => {
              const a = latest.answers[q.id];
              const shown = q.kind === "text" ? a?.text : a?.value ? t(`values.${a.value}`) : undefined;
              return (
                <li key={q.id} className={changed.has(q.id) ? "bg-warning/10 px-4 py-3" : "px-4 py-3"}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{label(q.label)}</p>
                      {a?.details ? <p className="text-sm font-medium" dir="auto">{a.details}</p> : null}
                      {changed.has(q.id) ? <p className="text-xs text-warning-foreground">{t("changedBadge")}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {shown ? (
                        <Badge variant={a?.value === "yes" ? "default" : "outline"} className={q.kind === "text" ? "max-w-xs whitespace-normal" : ""} dir="auto">{shown}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">{t("unanswered")}</span>
                      )}
                      {can(ctx, "patient.alerts.manage") && ((q.kind === "yes_no" && a?.value === "yes") || (q.kind === "text" && a?.text)) ? (
                        <PromoteButton patientId={patientId} questionId={q.id} />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {h.history.length > 1 || h.reviews.length ? (
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h3 className="mb-2 font-semibold">{t("history")}</h3>
          <ul className="space-y-1 text-muted-foreground">
            {h.history.map((x) => (
              <li key={x.id}>{formatDateTime(x.recordedAt, tz)} · {t(`sources.${x.source}`)}{x.recordedBy ? ` · ${x.recordedBy}` : ""} · v{x.versionNo}</li>
            ))}
            {h.reviews.map((r) => (
              <li key={r.id}>{formatDateTime(r.reviewedAt, tz)} · {t(r.outcome === "no_changes" ? "historyNoChanges" : "historyReviewed", { name: r.reviewer })}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
