import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BanknoteIcon, CalendarClockIcon, FileTextIcon, PiggyBankIcon, ScrollTextIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { can, type ClinicContext } from "@/server/auth/context";
import { listPatientPaymentSchedules } from "@/features/payment-plans/server";
import { pageFormat } from "../page-format";
import { getPatientAccount } from "../server";
import { ReceivePaymentButton } from "./billing-dialogs";
import { StateBadge } from "./state-badge";

/** Patient account tab: balance, unapplied credit, invoices and payments (server component). */
export async function PatientFinance({ ctx, patientId, canBill }: { ctx: ClinicContext; patientId: string; canBill: boolean }) {
  const t = await getTranslations("billing");
  const [account, fmt, schedules, tp] = await Promise.all([
    getPatientAccount(ctx, patientId), pageFormat(ctx),
    can(ctx, "payment.read") ? listPatientPaymentSchedules(ctx, patientId) : Promise.resolve([]),
    getTranslations("paymentPlans"),
  ]);
  const currency = ctx.organization.defaultCurrency;
  const m = (v: number, c = currency) => fmt.money(v, c);
  const today = todayInZone(ctx.organization.timezone);
  const canReceive = can(ctx, "payment.receive");

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("outstanding")}</p>
          <p className="text-2xl font-semibold tabular">{m(account.outstandingMinor)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("unapplied")}</p>
          <p className="text-2xl font-semibold tabular">{m(account.unappliedMinor)}</p>
        </div>
      </section>

      {schedules.filter((s) => s.installments.some((i) => i.remainingMinor > 0)).map((schedule) => {
        const next = schedule.installments.find((i) => i.remainingMinor > 0);
        const late = schedule.installments.filter((i) => i.remainingMinor > 0 && i.dueDate < today);
        return (
          <section key={schedule.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><CalendarClockIcon className="size-4 text-primary" aria-hidden />{tp("title")}</h3>
                <Link href={`/patients/${patientId}/treatment-plans/${schedule.planId}`} className="text-xs text-primary underline-offset-4 hover:underline">{tp("openPlan")}</Link>
              </div>
              {late.length ? <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">{tp("lateCount", { count: late.length })}</span> : null}
            </div>
            <ol className="mt-3 divide-y text-sm">
              {schedule.installments.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span>{tp("installment", { number: i.number })} · {formatDateOnly(i.dueDate)}</span>
                  <span className={i.remainingMinor === 0 ? "text-muted-foreground line-through tabular" : i.dueDate < today ? "font-medium text-destructive tabular" : "tabular"}>{m(i.amountMinor, schedule.currency)}</span>
                </li>
              ))}
            </ol>
            {canReceive && next ? (
              <div className="mt-3">
                <ReceivePaymentButton patientId={patientId} allocateTo={null} installmentId={next.id} defaultAmountMinor={next.remainingMinor}
                  currency={schedule.currency} symbol={fmt.symbol} today={today} label={tp("recordNext", { number: next.number })} variant="outline" icon={<BanknoteIcon aria-hidden />} />
              </div>
            ) : null}
          </section>
        );
      })}

      <div className="flex flex-wrap gap-2">
        {canBill ? (
          <ButtonLink href={`/patients/${patientId}/billing/new`}>
            <FileTextIcon aria-hidden />
            {t("bill")}
          </ButtonLink>
        ) : null}
        {canReceive && account.outstandingMinor > 0 ? (
          <ReceivePaymentButton
            patientId={patientId}
            allocateTo="auto"
            defaultAmountMinor={account.outstandingMinor}
            currency={currency}
            symbol={fmt.symbol}
            today={today}
            label={t("receivePayment")}
            variant="outline"
            icon={<BanknoteIcon aria-hidden />}
          />
        ) : null}
        {can(ctx, "payment.read") ? (
          <a href={`/print/statements/${patientId}`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted md:h-9">
            <ScrollTextIcon className="size-4" aria-hidden />
            {t("statement")}
          </a>
        ) : null}
        {canReceive ? (
          <ReceivePaymentButton
            patientId={patientId}
            allocateTo={null}
            currency={currency}
            symbol={fmt.symbol}
            today={today}
            label={t("deposit")}
            description={t("depositHint")}
            variant="outline"
            icon={<PiggyBankIcon aria-hidden />}
          />
        ) : null}
      </div>

      <section className="overflow-hidden rounded-xl border bg-card">
        <h2 className="border-b px-4 py-3 text-sm font-semibold">{t("title")}</h2>
        {account.invoices.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {account.invoices.map((r) => (
              <li key={r.id}>
                <Link href={`/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium tabular">{r.number ?? t("draftNumber")}</span>
                    <span className="block text-xs text-muted-foreground tabular">{formatDateOnly(r.documentDate)}</span>
                  </span>
                  <span className="text-end">
                    <span className="block font-semibold tabular">{m(r.totalMinor, r.currency)}</span>
                    {r.status === "issued" && r.balanceMinor > 0 ? (
                      <span className="block text-xs text-muted-foreground tabular">
                        {t("balance")} {m(r.balanceMinor, r.currency)}
                      </span>
                    ) : null}
                  </span>
                  <StateBadge state={r.state} label={t(`state.${r.state}`)} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can(ctx, "payment.read") ? (
        <section className="overflow-hidden rounded-xl border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">{t("payments")}</h2>
          {account.payments.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("noPayments")}</p>
          ) : (
            <ul className="divide-y">
              {account.payments.map((p) => (
                <li key={p.id}>
                  <Link href={`/payments/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium tabular">{p.receiptNumber}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDateOnly(p.receivedOn)} · {t(`methods.${p.method}`)} · {t(`purpose.${p.purpose}`)}
                        {p.status === "reversed" ? ` · ${t("reversed")}` : ""}
                      </span>
                    </span>
                    <span className="text-end">
                      <span className={p.status === "reversed" ? "block font-semibold tabular line-through" : "block font-semibold tabular"}>{m(p.amountMinor, p.currency)}</span>
                      {p.unappliedMinor > 0 ? (
                        <span className="block text-xs text-success tabular">
                          {t("unappliedShort")} {m(p.unappliedMinor, p.currency)}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
