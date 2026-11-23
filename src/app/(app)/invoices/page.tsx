import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileCheck2Icon, FileTextIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StateBadge } from "@/features/billing/components/state-badge";
import { pageFormat } from "@/features/billing/page-format";
import { listInvoices, listPatientsReadyToInvoice } from "@/features/billing/server";
import { formatDateOnly, parseDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("title") };
}

const STATES = ["all", "open", "paid", "draft", "void"] as const;

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "invoice.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const state = STATES.find((s) => s === sp.state) ?? "all";
  const from = parseDateOnly(str(sp.from)) ?? "";
  const to = parseDateOnly(str(sp.to)) ?? "";
  const q = str(sp.q);
  const page = Math.max(1, Number(sp.page) || 1);
  const [result, fmt, ready] = await Promise.all([
    listInvoices(ctx, { state, from: from || null, to: to || null, q, page, pageSize: 25 }),
    pageFormat(ctx),
    can(ctx, "invoice.create") ? listPatientsReadyToInvoice(ctx) : Promise.resolve([]),
  ]);
  const currency = ctx.organization.defaultCurrency;
  const m = (v: number) => fmt.money(v, currency);
  const href = (patch: Record<string, string | number | null>) => {
    const merged: Record<string, string | number | null> = { state, from, to, q, page, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "state" && v === "all") && !(k === "page" && v === 1)) p.set(k, String(v));
    return `/invoices${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader title={t("billing.title")} description={t("common.results", { count: result.count })} />

      {ready.length ? (
        <section className="mb-5 overflow-hidden rounded-xl border border-primary/20 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b bg-primary/5 px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <FileCheck2Icon className="size-5 text-primary" aria-hidden />
                {t("billing.readyToInvoice")}
              </h2>
              <p className="text-xs text-muted-foreground">{t("billing.readyToInvoiceHint", { count: ready.length })}</p>
            </div>
            <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
              {ready.reduce((total, row) => total + row.procedureCount, 0)}
            </span>
          </div>
          <ul className="divide-y">
            {ready.map((row) => (
              <li key={row.patientId} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <bdi>{`${row.lastName.toUpperCase()} ${row.firstName}`}</bdi>{" "}
                    <span className="text-xs text-muted-foreground">{row.patientNumber}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("billing.readySummary", {
                      count: row.procedureCount,
                      from: formatDateOnly(row.oldestDate),
                      to: formatDateOnly(row.newestDate),
                    })}
                  </p>
                </div>
                <p className="font-semibold tabular">{m(row.amountMinor)}</p>
                <Link
                  href={`/patients/${row.patientId}/billing/new`}
                  className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {t("billing.invoiceNow")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form method="get" className="mb-3 grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <input type="hidden" name="state" value={state} />
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("common.search")}
          <Input name="q" type="search" defaultValue={q} placeholder={t("billing.searchPlaceholder")} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("billing.from")}
          <Input name="from" type="date" defaultValue={from} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("billing.to")}
          <Input name="to" type="date" defaultValue={to} />
        </label>
        <Button type="submit">{t("billing.apply")}</Button>
      </form>

      <nav aria-label={t("billing.status")} className="mb-4 flex gap-1 overflow-x-auto rounded-lg border bg-card p-1 text-sm">
        {STATES.map((s) => (
          <Link
            key={s}
            href={href({ state: s, page: null })}
            aria-current={state === s ? "page" : undefined}
            className={cn("shrink-0 rounded-md px-3 py-1.5 font-medium", state === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t(`billing.filter.${s}`)}
          </Link>
        ))}
      </nav>

      <section aria-label={t("billing.totalsFiltered")} className="mb-4 grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-4">
        <p className="col-span-2 text-xs text-muted-foreground sm:col-span-4">{t("billing.totalsFiltered")}</p>
        {(
          [
            ["billing.total", result.totals.totalMinor],
            ["billing.paid", result.totals.paidMinor],
            ["billing.credited", result.totals.creditedMinor],
            ["billing.balance", result.totals.balanceMinor],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <p className="text-xs text-muted-foreground">{t(k)}</p>
            <p className="font-semibold tabular">{m(v)}</p>
          </div>
        ))}
      </section>

      {result.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <FileTextIcon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("billing.empty")}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-card md:hidden">
            {result.rows.map((r) => (
              <li key={r.id}>
                <Link href={`/invoices/${r.id}`} className="flex items-center gap-3 p-4 active:bg-accent">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium tabular">{r.number ?? t("billing.draftNumber")}</p>
                    <p className="truncate text-sm">
                      <bdi>{`${r.lastName.toUpperCase()} ${r.firstName}`}</bdi>
                    </p>
                    <p className="text-xs text-muted-foreground tabular">{formatDateOnly(r.documentDate) || formatDateOnly(r.createdAt.toISOString().slice(0, 10))}</p>
                  </div>
                  <div className="text-end">
                    <p className="font-semibold tabular">{m(r.totalMinor)}</p>
                    <StateBadge state={r.state} label={t(`billing.state.${r.state}`)} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.number")}</TableHead>
                  <TableHead>{t("billing.date")}</TableHead>
                  <TableHead>{t("billing.patient")}</TableHead>
                  <TableHead className="text-end">{t("billing.total")}</TableHead>
                  <TableHead className="text-end">{t("billing.paid")}</TableHead>
                  <TableHead className="text-end">{t("billing.balance")}</TableHead>
                  <TableHead>{t("billing.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((r) => (
                  <TableRow key={r.id} className="relative">
                    <TableCell className="tabular">
                      <Link href={`/invoices/${r.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                        {r.number ?? t("billing.draftNumber")}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular">{formatDateOnly(r.documentDate)}</TableCell>
                    <TableCell>
                      <bdi>{`${r.lastName.toUpperCase()} ${r.firstName}`}</bdi>
                      <span className="ms-1 text-xs text-muted-foreground">{r.patientNumber}</span>
                    </TableCell>
                    <TableCell className="text-end tabular">{m(r.totalMinor)}</TableCell>
                    <TableCell className="text-end tabular">{m(r.paidMinor)}</TableCell>
                    <TableCell className="text-end font-medium tabular">{m(r.balanceMinor)}</TableCell>
                    <TableCell>
                      <StateBadge state={r.state} label={t(`billing.state.${r.state}`)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.count} hrefFor={(n) => href({ page: n })} />
        </>
      )}
    </>
  );
}
