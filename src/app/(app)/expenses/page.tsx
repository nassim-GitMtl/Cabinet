import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReceiptIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageFormat } from "@/features/billing/page-format";
import { NewExpenseButton, PayExpenseButton, VoidExpenseButton } from "@/features/cash/components/cash-forms";
import { listExpenses } from "@/features/cash/server";
import { formatDateOnly, parseDateOnly, todayInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("expenses"))("title") };
}

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "expense.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sp = await searchParams;
  const today = todayInZone(ctx.organization.timezone);
  const from = parseDateOnly(typeof sp.from === "string" ? sp.from : "") ?? `${today.slice(0, 7)}-01`;
  const to = parseDateOnly(typeof sp.to === "string" ? sp.to : "") ?? today;
  const [list, fmt] = await Promise.all([listExpenses(ctx, { from, to }), pageFormat(ctx)]);
  const m = (v: number) => fmt.money(v, ctx.organization.defaultCurrency);
  const manage = can(ctx, "expense.manage");

  return (
    <>
      <PageHeader title={t("expenses.title")} actions={manage ? <NewExpenseButton symbol={fmt.symbol} today={today} /> : null} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <label className="grid gap-1 text-xs text-muted-foreground">{t("billing.from")}<Input type="date" name="from" defaultValue={from} /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">{t("billing.to")}<Input type="date" name="to" defaultValue={to} /></label>
        <Button type="submit" variant="outline">{t("billing.apply")}</Button>
      </form>
      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{t("expenses.total")}</p><p className="text-2xl font-semibold tabular">{m(list.totalMinor)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{t("expenses.unpaid")}</p><p className="text-2xl font-semibold tabular">{m(list.unpaidMinor)}</p></div>
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p className="mb-1 text-muted-foreground">{t("expenses.byCategory")}</p>
          {list.byCategory.map((c) => (
            <p key={c.category} className="flex justify-between tabular"><span>{t(`expenses.categories.${c.category as "other"}`)}</span><span>{m(c.totalMinor)}</span></p>
          ))}
        </div>
      </section>
      {list.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <ReceiptIcon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("expenses.empty")}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {list.rows.map(({ e, supplierName }) => (
            <li key={e.id} className={cn("flex flex-wrap items-center gap-3 p-4", e.status === "void" && "opacity-60")}>
              <div className="min-w-0 flex-1 basis-56">
                <p className={cn("font-medium", e.status === "void" && "line-through")}>{e.description}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateOnly(e.expenseDate)} · {t(`expenses.categories.${e.category as "other"}`)}
                  {supplierName ? <> · <bdi>{supplierName}</bdi></> : null}
                  {e.reference ? ` · ${e.reference}` : ""}
                  {e.status === "paid" && e.paymentMethod ? ` · ${t(`billing.methods.${e.paymentMethod}`)} ${formatDateOnly(e.paidOn)}` : ""}
                </p>
              </div>
              <Badge variant="outline">{t(`expenses.status.${e.status}`)}</Badge>
              <span className="w-32 text-end font-semibold tabular">{m(e.amountMinor)}</span>
              {manage && e.status === "unpaid" ? <PayExpenseButton id={e.id} /> : null}
              {manage && e.status !== "void" ? <VoidExpenseButton id={e.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
