import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeftIcon, CheckCircle2Icon, CircleDashedIcon, FlagIcon, LockKeyholeIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JourneyAccessButton } from "@/features/journey/components/journey-access-button";
import { getPortalJourney } from "@/features/journey/portal";
import { formatDateOnly } from "@/lib/dates";
import { requirePatientSession } from "@/server/portal/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("journey.portal"))("title"), robots: { index: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The patient's visual treatment journey with one clinic: steps, plan progress, photos and before/after pairs. */
export default async function PortalJourneyPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  if (!UUID.test(organizationId)) notFound();
  const ctx = await requirePatientSession();
  const [journey, locale, t] = await Promise.all([getPortalJourney(ctx, organizationId), getLocale(), getTranslations("journey")]);
  if (!journey) notFound();
  const granted = journey.access === "granted";
  const label = (n: Record<string, string | undefined>) => n[locale] || n.fr || "";
  const src = (itemId: string, side?: "before" | "after") => `/portal/journey/${organizationId}/files/${itemId}${side ? `?side=${side}` : ""}`;

  return (
    <div className="space-y-6">
      <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("portal.back")}
      </Link>
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground"><bdi>{journey.organizationName}</bdi></p>
        <h1 className="text-2xl font-semibold">{t("portal.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("portal.intro")}</p>
      </header>

      {!granted ? (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><LockKeyholeIcon className="size-4 text-primary" aria-hidden />{t("portal.offTitle")}</CardTitle>
            <CardDescription>{t("portal.offBody", { count: journey.sharedCount })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
              <li>{t("portal.point1")}</li>
              <li>{t("portal.point2")}</li>
              <li>{t("portal.point3")}</li>
            </ul>
            <JourneyAccessButton organizationId={organizationId} granted={false} />
          </CardContent>
        </Card>
      ) : (
        <>
          {journey.progress.map((plan) => {
            const done = plan.steps.filter((s) => s.doneAt).length;
            return (
              <Card key={plan.id}>
                <CardHeader>
                  <CardTitle className="text-base"><bdi>{plan.title}</bdi></CardTitle>
                  <CardDescription>{t("progress.count", { done, total: plan.steps.length })}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={plan.steps.length} aria-valuenow={done}>
                    <div className="h-full bg-primary" style={{ width: `${plan.steps.length ? Math.round((done / plan.steps.length) * 100) : 0}%` }} />
                  </div>
                  <ol className="space-y-1.5 text-sm">
                    {plan.steps.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        {s.doneAt ? <CheckCircle2Icon className="size-4 shrink-0 text-primary" aria-hidden /> : <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                        <span className="min-w-0 flex-1"><bdi>{label(s.name)}</bdi>{s.toothNumber ? <span className="text-muted-foreground"> · {t("portal.tooth", { tooth: s.toothNumber })}</span> : null}</span>
                        <span className="text-xs text-muted-foreground">{s.doneAt ? t("portal.doneOn", { date: formatDateOnly(s.doneAt.toISOString().slice(0, 10)) }) : t("portal.planned")}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            );
          })}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t("portal.shared")}</h2>
            {journey.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("portal.nothingYet")}</p> : null}
            <ol className="space-y-4 border-s-2 border-primary/20 ps-4">
              {journey.items.map((item) => (
                <li key={item.id} className="relative">
                  <span className="absolute -start-[1.4rem] top-1.5 size-3 rounded-full border-2 border-background bg-primary" aria-hidden />
                  <p className="text-xs text-muted-foreground">{formatDateOnly(item.eventDate)}</p>
                  <h3 className="flex items-center gap-1.5 font-medium">{item.kind === "milestone" ? <FlagIcon className="size-4 text-primary" aria-hidden /> : null}<bdi>{item.title}</bdi></h3>
                  {item.body ? <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground" dir="auto">{item.body}</p> : null}
                  {item.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private, session-checked route
                    <img src={src(item.id)} alt={item.title} loading="lazy" className="mt-2 max-h-80 w-full max-w-md rounded-lg border object-contain" />
                  ) : null}
                  {item.kind === "comparison" ? (
                    <div className="mt-2 grid max-w-xl grid-cols-2 gap-2">
                      {(["before", "after"] as const).map((side) => (
                        <figure key={side}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- private, session-checked route */}
                          <img src={src(item.id, side)} alt={`${item.title} · ${t(side)}`} loading="lazy" className="aspect-square w-full rounded-lg border object-cover" />
                          <figcaption className="mt-1 text-center text-xs text-muted-foreground">{t(side)}</figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <div className="rounded-xl border bg-card p-4 text-sm">
            <p className="mb-2 text-muted-foreground">{t("portal.hideExplain")}</p>
            <JourneyAccessButton organizationId={organizationId} granted />
          </div>
        </>
      )}
    </div>
  );
}
