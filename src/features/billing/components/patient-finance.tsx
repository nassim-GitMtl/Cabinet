import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BanknoteIcon, FileTextIcon, PiggyBankIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { can, type ClinicContext } from "@/server/auth/context";
import { pageFormat } from "../page-format";
import { getPatientAccount } from "../server";
import { ReceivePaymentButton } from "./billing-dialogs";
import { StateBadge } from "./state-badge";

/** Patient account tab: balance, unapplied credit, invoices and payments (server component). */
export async function PatientFinance({ ctx, patientId, canBill }: { ctx: ClinicContext; patientId: string; canBill: boolean }) {
  const t = await getTranslations("billing");
  const [account, fmt] = await Promise.all([getPatientAccount(ctx, patientId), pageFormat(ctx)]);
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
