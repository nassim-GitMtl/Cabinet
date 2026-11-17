import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { PrintButton } from "@/components/print/print-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageFormat } from "@/features/billing/page-format";
import { ApproveCashButton, CloseCashForm, MovementButton, OpenCashForm } from "@/features/cash/components/cash-forms";
import { getCashDay, listCashSessions } from "@/features/cash/server";
import { formatDateOnly, formatDateTime, parseDateOnly, todayInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("cash"))("title") };
}

export default async function CashPage({ searchParams }: PageProps<"/cash">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "cash.manage")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sp = await searchParams;
  const today = todayInZone(ctx.organization.timezone);
  const date = parseDateOnly(typeof sp.date === "string" ? sp.date : "") ?? today;
  const [day, history, fmt] = await Promise.all([getCashDay(ctx, date), listCashSessions(ctx, 14), pageFormat(ctx)]);
  const m = (v: number) => fmt.money(v, ctx.organization.defaultCurrency);
  const s = day.session;
  const b = day.breakdown;
  const rows: [string, number, string?][] = s
    ? [
        [t("cash.openingFloat"), s.openingFloatMinor],
        [t("cash.cashReceipts", { count: b.cashReceiptCount }), b.cashReceiptsMinor, "+"],
        [t("cash.cashRefunds"), -b.cashRefundsMinor, "−"],
        [t("cash.cashExpenses"), -b.cashExpensesMinor, "−"],
        [t("cash.transfersIn"), b.transfersInMinor, "+"],
        [t("cash.transfersOut"), -b.transfersOutMinor, "−"],
      ]
    : [];

  return (
    <>
      <PageHeader
        title={t("cash.title")}
        description={formatDateOnly(date)}
        actions={
          <form method="get" className="no-print flex items-end gap-2">
            <Input type="date" name="date" defaultValue={date} max={today} aria-label={t("reports.day")} />
            <Button type="submit" variant="outline">{t("reports.show")}</Button>
            {s && s.status !== "open" ? <PrintButton /> : null}
          </form>
        }
      />
      {!s ? (
        <section className="rounded-xl border bg-card p-5">
          <p className="mb-3 text-sm text-muted-foreground">{t("cash.notOpened")}</p>
          <OpenCashForm date={date} symbol={fmt.symbol} />
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">{t("cash.expected")}</h2>
              <Badge variant={s.status === "open" ? "secondary" : "outline"}>{t(`cash.status.${s.status}`)}</Badge>
            </div>
            <dl className="space-y-2 text-sm">
              {rows.map(([label, v]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular">{m(v)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                <dt>{t("cash.expected")}</dt>
                <dd className="tabular">{m(s.status === "open" ? day.liveExpectedMinor! : s.expectedMinor!)}</dd>
              </div>
              {s.status !== "open" ? (
                <>
                  <div className="flex justify-between gap-4">
                    <dt>{t("cash.counted")}</dt>
                    <dd className="font-semibold tabular">{m(s.countedMinor!)}</dd>
                  </div>
                  <div className={cn("flex justify-between gap-4", s.countedMinor !== s.expectedMinor && "text-destructive")}>
                    <dt>{t("cash.discrepancy")}</dt>
                    <dd className="font-semibold tabular">{m(s.countedMinor! - s.expectedMinor!)}</dd>
                  </div>
                  {s.discrepancyReason ? <p className="text-xs text-muted-foreground">{s.discrepancyReason}</p> : null}
                </>
              ) : null}
            </dl>
            {b.nonCash.length ? (
              <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium">{t("cash.nonCash")}</p>
                {b.nonCash.map((n) => (
                  <p key={n.method} className="flex justify-between tabular">
                    <span>{t(`billing.methods.${n.method}`)}</span>
                    <span>{m(n.totalMinor)}</span>
                  </p>
                ))}
              </div>
            ) : null}
            {b.movements.length ? (
              <ul className="mt-4 divide-y text-sm">
                {b.movements.map((mv) => (
                  <li key={mv.id} className="flex justify-between gap-3 py-2">
                    <span>{t(`cash.${mv.direction}`)} · {mv.reason}</span>
                    <span className="tabular">{mv.direction === "out" ? "−" : "+"}{m(mv.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">
              {t("cash.openedBy", { name: day.names[s.openedByUserId] ?? "", date: formatDateTime(s.openedAt, ctx.organization.timezone, fmt.intl) })}
              {s.closedByUserId && s.closedAt ? ` · ${t("cash.closedBy", { name: day.names[s.closedByUserId] ?? "", date: formatDateTime(s.closedAt, ctx.organization.timezone, fmt.intl) })}` : ""}
              {s.approvedByUserId && s.approvedAt ? ` · ${t("cash.approvedBy", { name: day.names[s.approvedByUserId] ?? "", date: formatDateTime(s.approvedAt, ctx.organization.timezone, fmt.intl) })}` : ""}
            </p>
            {day.changedSinceClose ? (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{t("cash.changedSinceClose")}</AlertDescription>
              </Alert>
            ) : null}
          </section>
          <aside className="no-print space-y-4">
            {s.status === "open" ? (
              <>
                <MovementButton sessionId={s.id} symbol={fmt.symbol} />
                {can(ctx, "cash.close") ? (
                  <section className="rounded-xl border bg-card p-4">
                    <h2 className="mb-3 font-semibold">{t("cash.close")}</h2>
                    <CloseCashForm sessionId={s.id} symbol={fmt.symbol} />
                  </section>
                ) : null}
              </>
            ) : s.status === "closed" && can(ctx, "cash.close.approve") ? (
              <section className="rounded-xl border bg-card p-4">
                <p className="mb-3 text-sm text-muted-foreground">{t("cash.approveHint")}</p>
                <ApproveCashButton sessionId={s.id} />
              </section>
            ) : null}
          </aside>
        </div>
      )}

      <section className="no-print mt-6 overflow-hidden rounded-xl border bg-card">
        <h2 className="border-b px-4 py-3 text-sm font-semibold">{t("cash.history")}</h2>
        <ul className="divide-y text-sm">
          {history.map((h) => (
            <li key={h.id}>
              <Link href={`/cash?date=${h.businessDate}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent/50">
                <span className="tabular">{formatDateOnly(h.businessDate)}</span>
                <span className="flex items-center gap-3">
                  {h.countedMinor !== null && h.expectedMinor !== null && h.countedMinor !== h.expectedMinor ? (
                    <span className="text-xs text-destructive tabular">{m(h.countedMinor - h.expectedMinor)}</span>
                  ) : null}
                  <Badge variant="outline">{t(`cash.status.${h.status}`)}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
