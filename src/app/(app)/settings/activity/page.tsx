import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeftIcon, HistoryIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  ACTIVITY_CATEGORIES,
  isActivityCategory,
  listActivity,
  listActivityPeople,
  listRecordChanges,
  withTitle,
} from "@/features/activity/server";
import { pageFormat } from "@/features/billing/page-format";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { addDays, formatDateOnly, parseDateOnly, timeInZone, todayInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("activity"))("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Translation key of an action code ("invoice.issued" -> "invoice_issued"; next-intl keys cannot contain dots). */
const actionKey = (action: string) => action.replaceAll(".", "_");

export default async function ActivityPage({ searchParams }: PageProps<"/settings/activity">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "audit.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = todayInZone(ctx.organization.timezone);
  const view = str("view") === "changes" ? "changes" : "actions";
  const from = parseDateOnly(str("from")) ?? addDays(today, -6);
  const to = parseDateOnly(str("to")) ?? today;
  const actorUserId = UUID.test(str("person")) ? str("person") : null;
  const patientId = UUID.test(str("patient")) ? str("patient") : null;
  const category = isActivityCategory(str("area")) ? str("area") : null;
  const includeViews = str("views") === "1";
  const before = str("before") || null;
  const locale = await getLocale();
  const intl = INTL_LOCALE[isLocale(locale) ? locale : "fr"];
  const tz = ctx.organization.timezone;

  const [people, fmt, actions, changes] = await Promise.all([
    listActivityPeople(ctx),
    pageFormat(ctx),
    view === "actions" ? listActivity(ctx, { from, to, actorUserId, patientId, category: category as never, includeViews, before }) : null,
    view === "changes" ? listRecordChanges(ctx, { from, to, actorUserId, before }) : null,
  ]);
  const personName = (p: { title: string | null; displayName: string }) => withTitle(p.title, p.displayName);
  const params = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const base: Record<string, string | null> = { view: view === "changes" ? "changes" : null, from, to, person: actorUserId, patient: patientId, area: category, views: includeViews ? "1" : null };
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) q.set(k, v);
    return `/settings/activity?${q}`;
  };
  const who = (r: { actorType: string; actorName: string | null; actorUserId: string | null }) =>
    r.actorType === "staff" ? r.actorName ?? t("activity.formerStaff") : t(`activity.actorTypes.${r.actorType as "system"}`);
  const actionLabel = (action: string) => (t.has(`activity.actions.${actionKey(action)}` as never) ? t(`activity.actions.${actionKey(action)}` as never) : action);
  const tableLabel = (table: string) => (t.has(`activity.tables.${table}` as never) ? t(`activity.tables.${table}` as never) : table);
  const dayOf = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const details = (metadata: Record<string, unknown>) =>
    Object.entries(metadata ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(typeof v === "string" && UUID.test(v)) && typeof v !== "object")
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${typeof v === "number" && /Minor$/.test(k) ? fmt.money(v, ctx.organization.defaultCurrency) : String(v)}`)
      .concat(
        Object.entries(metadata ?? {})
          .filter(([, v]) => Array.isArray(v) && v.every((x) => typeof x === "string" && !UUID.test(x)))
          .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`),
      );

  /** The person's name filters the log on them (title text says so). */
  const Person = ({ r }: { r: { actorType: string; actorName: string | null; actorUserId: string | null } }) =>
    r.actorUserId && r.actorType === "staff" && !actorUserId ? (
      <Link href={params({ person: r.actorUserId, before: null })} title={t("activity.onlyThisPerson")} className="font-medium hover:underline">
        <bdi>{who(r)}</bdi>
      </Link>
    ) : (
      <span className="font-medium"><bdi>{who(r)}</bdi></span>
    );

  const list = view === "actions" ? actions! : changes!;
  let lastDay = "";

  return (
    <>
      <Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("settings.title")}
      </Link>
      <PageHeader title={t("activity.title")} description={t("activity.subtitle")} />

      <nav className="mb-4 inline-flex rounded-lg border bg-card p-0.5 text-sm" aria-label={t("activity.title")}>
        {(["actions", "changes"] as const).map((v) => (
          <Link
            key={v}
            href={params({ view: v === "changes" ? "changes" : null, before: null })}
            aria-current={view === v ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 font-medium", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            {t(`activity.views.${v}`)}
          </Link>
        ))}
      </nav>
      <p className="mb-3 text-xs text-muted-foreground">{t(`activity.views.${view}Hint`)}</p>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        {view === "changes" ? <input type="hidden" name="view" value="changes" /> : null}
        {patientId ? <input type="hidden" name="patient" value={patientId} /> : null}
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("billing.from")}
          <Input type="date" name="from" defaultValue={from} max={today} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("billing.to")}
          <Input type="date" name="to" defaultValue={to} max={today} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("activity.person")}
          <NativeSelect name="person" defaultValue={actorUserId ?? ""}>
            <NativeSelectOption value="">{t("activity.everyone")}</NativeSelectOption>
            {people.map((p) => (
              <NativeSelectOption key={p.userId} value={p.userId}>
                {personName(p)}
                {p.status === "active" ? "" : ` (${t("activity.inactive")})`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {view === "actions" ? (
          <>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("activity.area")}
              <NativeSelect name="area" defaultValue={category ?? ""}>
                <NativeSelectOption value="">{t("activity.allAreas")}</NativeSelectOption>
                {Object.keys(ACTIVITY_CATEGORIES).map((c) => (
                  <NativeSelectOption key={c} value={c}>
                    {t(`activity.areas.${c as "patients"}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="views" value="1" defaultChecked={includeViews} className="size-4 accent-primary" />
              {t("activity.includeViews")}
            </label>
          </>
        ) : null}
        <Button type="submit" variant="outline">{t("billing.apply")}</Button>
      </form>

      {patientId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">{t("activity.patientFilter")}</Badge>
          <ButtonLink href={params({ patient: null, before: null })} variant="ghost" size="sm">
            {t("activity.clearPatient")}
          </ButtonLink>
        </div>
      ) : null}

      {list.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <HistoryIcon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("activity.empty")}</p>
        </div>
      ) : (
        <ol className="overflow-hidden rounded-xl border bg-card">
          {view === "actions"
            ? actions!.rows.map((r) => {
                const day = dayOf(r.occurredAt);
                const header = day !== lastDay ? ((lastDay = day), day) : null;
                const extra = details(r.metadata);
                return (
                  <li key={r.id}>
                    {header ? <p className="border-b bg-muted/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground">{formatDateOnly(header)}</p> : null}
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm last:border-0">
                      <time className="w-12 shrink-0 tabular text-muted-foreground" dateTime={r.occurredAt.toISOString()} title={r.occurredAt.toLocaleString(intl, { timeZone: tz })}>
                        {timeInZone(r.occurredAt, tz)}
                      </time>
                      <span className="min-w-0 flex-1 basis-64">
                        <Person r={r} />
                        <span className="text-muted-foreground"> · </span>
                        <span>{actionLabel(r.action)}</span>
                        {r.patientName ? (
                          <>
                            {" · "}
                            {can(ctx, "patient.read") ? (
                              <Link href={`/patients/${r.patientId}`} className="font-medium hover:underline"><bdi>{r.patientName}</bdi></Link>
                            ) : (
                              <bdi>{r.patientName}</bdi>
                            )}
                          </>
                        ) : null}
                        {r.invoiceNumber ? (
                          <>
                            {" · "}
                            {can(ctx, "invoice.read") ? <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">{r.invoiceNumber}</Link> : r.invoiceNumber}
                          </>
                        ) : null}
                        {extra.length ? <span className="block text-xs text-muted-foreground" dir="auto">{extra.join(" · ")}</span> : null}
                      </span>
                    </div>
                  </li>
                );
              })
            : changes!.rows.map((r) => {
                const day = dayOf(r.occurredAt);
                const header = day !== lastDay ? ((lastDay = day), day) : null;
                return (
                  <li key={r.id}>
                    {header ? <p className="border-b bg-muted/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground">{formatDateOnly(header)}</p> : null}
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm last:border-0">
                      <time className="w-12 shrink-0 tabular text-muted-foreground" dateTime={r.occurredAt.toISOString()}>
                        {timeInZone(r.occurredAt, tz)}
                      </time>
                      <span className="min-w-0 flex-1 basis-64">
                        <Person r={r} />
                        <span className="text-muted-foreground"> · </span>
                        <span>{t(`activity.operations.${r.operation as "insert"}`)}</span>
                        <span className="text-muted-foreground"> · </span>
                        <span>{tableLabel(r.tableName)}</span>
                        {r.operation === "update" && r.changedColumns.length ? (
                          <span className="block text-xs text-muted-foreground" dir="ltr">
                            {t("activity.fields")} {r.changedColumns.join(", ")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </li>
                );
              })}
        </ol>
      )}

      {list.hasMore && list.next ? (
        <div className="mt-4 text-center">
          <ButtonLink href={params({ before: list.next })} variant="outline">
            {t("activity.older")}
          </ButtonLink>
        </div>
      ) : null}
    </>
  );
}
