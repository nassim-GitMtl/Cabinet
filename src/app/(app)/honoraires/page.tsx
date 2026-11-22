import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileSpreadsheetIcon, HandCoinsIcon, HistoryIcon, StethoscopeIcon, WalletCardsIcon, WalletIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { PrintButton } from "@/components/print/print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { pageFormat } from "@/features/billing/page-format";
import {
  AdjustEntryButton,
  CloseMonthButton,
  PaymentButton,
  ProviderProfileButton,
  ReversePaymentButton,
  TermButton,
} from "@/features/honoraria/components/honoraria-forms";
import { canSeeHonoraria, getHonorariumReport, listFeeProviders, listFeeServices, listFeeTerms } from "@/features/honoraria/server";
import { addDays, formatDateOnly, parseDateOnly, todayInZone } from "@/lib/dates";
import { minorToInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("honoraria"))("title") };
}

const ROW_LIMIT = 500;

function lastDayOfMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, "0")}`;
}

export default async function HonorariaPage({ searchParams }: PageProps<"/honoraires">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!canSeeHonoraria(ctx)) return <ForbiddenState message={t("errors.forbiddenPage")} />;

  const sp = await searchParams;
  const today = todayInZone(ctx.organization.timezone);
  const thisMonth = today.slice(0, 7);
  const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
  let from = parseDateOnly(typeof sp.from === "string" ? sp.from : "") ?? `${thisMonth}-01`;
  let to = parseDateOnly(typeof sp.to === "string" ? sp.to : "") ?? today;
  if (from > to) [from, to] = [to, from];
  const seeAll = can(ctx, "honorarium.read.all") || can(ctx, "honorarium.manage") || can(ctx, "honorarium.pay") || can(ctx, "honorarium.close");
  const requested = seeAll && typeof sp.providerId === "string" && /^[0-9a-f-]{36}$/i.test(sp.providerId) ? sp.providerId : null;
  const manage = can(ctx, "honorarium.manage");

  const [report, providers, fmt, terms, feeServices] = await Promise.all([
    getHonorariumReport(ctx, { providerId: requested, from, to }, { rowLimit: ROW_LIMIT }),
    listFeeProviders(ctx),
    pageFormat(ctx),
    manage ? listFeeTerms(ctx) : Promise.resolve([]),
    manage ? listFeeServices(ctx) : Promise.resolve([]),
  ]);
  const currency = ctx.organization.defaultCurrency;
  const m = (v: number) => fmt.money(v, currency);
  const nameOf = (p: { title: string | null; displayName: string }) => [p.title, p.displayName].filter(Boolean).join(" ");
  const providerOptions = providers.map((p) => ({ value: p.id, label: nameOf(p) + (p.status === "active" ? "" : ` (${t("honoraria.inactive")})`) }));
  const query = (extra: Record<string, string>) => new URLSearchParams({ from, to, ...(requested ? { providerId: requested } : {}), ...extra }).toString();
  const ruleText = (type: "percent" | "fixed", value: number) =>
    type === "percent" ? `${value / 100} %` : t("honoraria.fixedPerUnit", { amount: m(value) });
  const selected = requested ? report.summary.find((s) => s.providerId === requested) : report.summary.length === 1 ? report.summary[0] : undefined;

  const cards = [
    { key: "produced", value: report.totals.producedMinor, icon: StethoscopeIcon, hint: t("honoraria.cards.producedHint") },
    { key: "earned", value: report.totals.earnedMinor, icon: HandCoinsIcon, hint: t("honoraria.cards.earnedHint") },
    { key: "payable", value: report.totals.payableMinor, icon: WalletCardsIcon, hint: t("honoraria.cards.payableHint") },
    { key: "balance", value: report.totals.balanceMinor, icon: WalletIcon, hint: t("honoraria.cards.balanceHint") },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("honoraria.title")}
        description={t("honoraria.subtitle")}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            {can(ctx, "honorarium.pay") && providerOptions.length ? (
              <PaymentButton
                providers={providerOptions}
                today={today}
                symbol={fmt.symbol}
                suggested={selected && selected.balanceMinor > 0 ? { providerId: selected.providerId, amount: minorToInput(selected.balanceMinor, currency) } : undefined}
              />
            ) : null}
            {manage ? (
              <ButtonLink href="/honoraires/reprise" variant="outline">
                <HistoryIcon aria-hidden />
                {t("honoraria.assign.link")}
              </ButtonLink>
            ) : null}
            {can(ctx, "report.export") ? (
              <a href={`/api/exports/honoraires?${query({})}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9">
                <FileSpreadsheetIcon className="size-4" aria-hidden />
                CSV
              </a>
            ) : null}
            <PrintButton />
          </div>
        }
      />

      <form method="get" className="no-print flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("billing.from")}
          <Input type="date" name="from" defaultValue={from} max={today} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("billing.to")}
          <Input type="date" name="to" defaultValue={to} />
        </label>
        {seeAll ? (
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("honoraria.doctor")}
            <NativeSelect name="providerId" defaultValue={requested ?? ""}>
              <NativeSelectOption value="">{t("honoraria.allDoctors")}</NativeSelectOption>
              {providerOptions.map((p) => (
                <NativeSelectOption key={p.value} value={p.value}>
                  {p.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        <Button type="submit" variant="outline">{t("billing.apply")}</Button>
        <div className="flex gap-1 text-sm">
          <Link className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" href={`/honoraires?${new URLSearchParams({ from: `${thisMonth}-01`, to: today, ...(requested ? { providerId: requested } : {}) })}`}>
            {t("honoraria.thisMonth")}
          </Link>
          <Link className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" href={`/honoraires?${new URLSearchParams({ from: `${lastMonth}-01`, to: lastDayOfMonth(lastMonth), ...(requested ? { providerId: requested } : {}) })}`}>
            {t("honoraria.lastMonth")}
          </Link>
        </div>
      </form>

      <p className="hidden text-sm print:block">
        {t("honoraria.title")} · {formatDateOnly(from)} – {formatDateOnly(to)}
      </p>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ key, value, icon: Icon, hint }) => (
          <article key={key} className="rounded-xl border bg-card p-4">
            <Icon className="mb-2 size-5 text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">{t(`honoraria.cards.${key}`)}</p>
            <p className={cn("text-2xl font-semibold tabular", key === "balance" && value < 0 && "text-amber-700")}>{m(value)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </article>
        ))}
      </section>

      {report.summary.length > 1 || (seeAll && report.summary.length) ? (
        <section className="overflow-hidden rounded-xl border bg-card">
          <h2 className="border-b px-4 py-3 font-semibold">{t("honoraria.byDoctor")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{t("honoraria.doctor")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.acts")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.cards.produced")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.cards.earned")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.cards.payable")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.paidInPeriod")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.awaitingPatient")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.cards.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {report.summary.map((s) => (
                  <tr key={s.providerId} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/honoraires?${new URLSearchParams({ from, to, providerId: s.providerId })}`} className="font-medium hover:underline">
                        <bdi>{s.name}</bdi>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-end tabular">{s.lines}</td>
                    <td className="px-3 py-2 text-end tabular">{m(s.producedMinor)}</td>
                    <td className="px-3 py-2 text-end tabular">{m(s.earnedMinor)}</td>
                    <td className="px-3 py-2 text-end tabular">{m(s.payableMinor)}</td>
                    <td className="px-3 py-2 text-end tabular">{m(s.paidMinor)}</td>
                    <td className="px-3 py-2 text-end tabular text-muted-foreground">{m(s.awaitingPatientMinor)}</td>
                    <td className={cn("px-3 py-2 text-end font-semibold tabular", s.balanceMinor < 0 && "text-amber-700")}>{m(s.balanceMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border bg-card">
        <h2 className="border-b px-4 py-3 font-semibold">{t("honoraria.details")}</h2>
        {report.rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{t("honoraria.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{t("honoraria.date")}</th>
                  {seeAll ? <th className="px-3 py-2 text-start font-medium">{t("honoraria.doctor")}</th> : null}
                  <th className="px-3 py-2 text-start font-medium">{t("honoraria.patient")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("honoraria.service")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.lineAmount")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("honoraria.rule")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.share")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.cards.payable")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("honoraria.clinicShare")}</th>
                  {manage ? <th className="no-print px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.id} className={cn("border-b last:border-0", r.kind === "adjustment" && "bg-amber-50/60 dark:bg-amber-950/20")}>
                    <td className="whitespace-nowrap px-3 py-2 tabular">{formatDateOnly(r.effectiveDate)}</td>
                    {seeAll ? <td className="px-3 py-2"><bdi>{r.providerSnapshot.displayName}</bdi></td> : null}
                    <td className="px-3 py-2">
                      {can(ctx, "patient.read") ? (
                        <Link href={`/patients/${r.patientId}`} className="hover:underline"><bdi>{r.patientName}</bdi></Link>
                      ) : (
                        <bdi>{r.patientName}</bdi>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {can(ctx, "invoice.read") ? <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">{r.invoiceNumber}</Link> : r.invoiceNumber}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <bdi>{fmt.label(r.serviceSnapshot.name)}</bdi>
                      {r.kind === "adjustment" ? (
                        <span className="block text-xs text-amber-700"><bdi>{t("honoraria.adjustment")} · {r.reason}</bdi></span>
                      ) : r.kind === "backfill" ? (
                        <span className="block text-xs text-muted-foreground">{t("honoraria.assigned")}</span>
                      ) : r.reason ? (
                        <span className="block text-xs text-muted-foreground"><bdi>{r.reason}</bdi></span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-end tabular">
                      {r.kind === "adjustment" ? "" : m(r.lineAmountMinor)}
                      {r.labFeeMinor > 0 && r.kind !== "adjustment" ? <span className="block text-xs text-muted-foreground">{t("honoraria.labShort", { amount: m(r.labFeeMinor) })}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{r.kind === "adjustment" ? "" : ruleText(r.ruleType, r.ruleValue)}</td>
                    <td className="px-3 py-2 text-end font-medium tabular">
                      {m(r.earnedMinor)}
                      {r.earnedMinor !== r.physicianShareMinor ? <span className="block text-xs text-muted-foreground line-through">{m(r.physicianShareMinor)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-end tabular">{m(r.payableMinor)}</td>
                    <td className="px-3 py-2 text-end tabular text-muted-foreground">{m(r.clinicShareMinor)}</td>
                    {manage ? (
                      <td className="no-print px-1 py-1 text-end">
                        {r.kind !== "adjustment" ? <AdjustEntryButton entryId={r.id} symbol={fmt.symbol} /> : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {report.rowsTruncated ? <p className="border-t p-3 text-center text-xs text-muted-foreground">{t("honoraria.truncated", { count: ROW_LIMIT })}</p> : null}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="font-semibold">{t("honoraria.payments.title")}</h2>
        </div>
        {report.payments.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("honoraria.payments.empty")}</p>
        ) : (
          <ul className="divide-y">
            {report.payments.map((p) => (
              <li key={p.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", (p.reversed || p.reversesPaymentId) && "text-muted-foreground")}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-medium"><bdi>{p.providerName}</bdi></p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateOnly(p.paidOn)} · {t(`billing.methods.${p.method}`)}
                    {p.reference ? <> · <bdi>{p.reference}</bdi></> : null}
                    {p.note ? <> · <bdi>{p.note}</bdi></> : null}
                  </p>
                </div>
                {p.reversesPaymentId ? <Badge variant="outline">{t("honoraria.payments.reversal")}</Badge> : null}
                {p.reversed ? <Badge variant="outline">{t("honoraria.payments.reversed")}</Badge> : null}
                <span className={cn("w-32 text-end font-semibold tabular", p.reversed && "line-through")}>{m(p.amountMinor)}</span>
                {can(ctx, "honorarium.pay") && !p.reversed && !p.reversesPaymentId ? <ReversePaymentButton paymentId={p.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="no-print overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="font-semibold">{t("honoraria.closures.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("honoraria.closures.explain")}</p>
          </div>
          {can(ctx, "honorarium.close") && providerOptions.length ? <CloseMonthButton providers={providerOptions} lastMonth={lastMonth} /> : null}
        </div>
        {report.closures.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("honoraria.closures.empty")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {report.closures.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span><bdi>{c.providerName}</bdi> · <span className="tabular">{c.periodMonth.slice(0, 7)}</span></span>
                <span className="text-xs text-muted-foreground">{c.note ? <bdi>{c.note}</bdi> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manage ? (
        <section className="no-print space-y-3">
          <h2 className="text-lg font-semibold">{t("honoraria.config.title")}</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{t("honoraria.config.providers")}</h3>
            {providers.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{t("honoraria.config.noProviders")}</p>
            ) : (
              <ul className="divide-y">
                {providers.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium"><bdi>{nameOf(p)}</bdi>{p.status !== "active" ? <span className="ms-2 text-xs text-muted-foreground">{t("honoraria.inactive")}</span> : null}</p>
                      {p.specialty ? <p className="text-xs text-muted-foreground"><bdi>{p.specialty}</bdi></p> : null}
                    </div>
                    <span className="tabular">{t("honoraria.config.defaultRateValue", { rate: p.defaultFeeRateBp / 100 })}</span>
                    <ProviderProfileButton provider={{ id: p.id, name: nameOf(p), specialty: p.specialty, defaultFeeRateBp: p.defaultFeeRateBp }} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">{t("honoraria.config.rules")}</h3>
                <p className="text-xs text-muted-foreground">{t("honoraria.config.rulesExplain")}</p>
              </div>
              {providerOptions.length && feeServices.length ? (
                <TermButton
                  providers={providerOptions}
                  services={feeServices.map((s) => ({ value: s.id, label: `${s.code} · ${fmt.label(s.name)}${s.isActive ? "" : ` (${t("honoraria.inactive")})`}` }))}
                  symbol={fmt.symbol}
                />
              ) : null}
            </div>
            {terms.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{t("honoraria.config.noRules")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {terms.map((term) => {
                  const provider = providers.find((p) => p.id === term.providerId);
                  return (
                    <li key={term.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1">
                        <bdi>{provider ? nameOf(provider) : ""}</bdi> · <bdi>{term.serviceCode} {fmt.label(term.serviceName)}</bdi>
                      </span>
                      {term.priceMinor !== null ? <span className="text-xs text-muted-foreground">{t("honoraria.config.priceValue", { amount: fmt.money(term.priceMinor, term.currency) })}</span> : null}
                      <span className="font-medium tabular">{ruleText(term.ruleType, term.ruleValue)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("honoraria.config.labExplain")}</p>
        </section>
      ) : null}
    </div>
  );
}
