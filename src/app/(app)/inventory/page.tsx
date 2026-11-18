import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangleIcon, BoxesIcon, CalendarClockIcon, PackageCheckIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { InventoryForms } from "@/features/inventory/components/inventory-forms";
import { PurchaseOrderForm, PurchaseOrderReceiptForm } from "@/features/inventory/components/purchase-orders";
import { getInventory, getPurchaseOrders } from "@/features/inventory/server";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("inventory"))("title") };
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="text-primary">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function InventoryPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations("inventory");
  if (!can(ctx, "inventory.manage")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const today = todayInZone(ctx.organization.timezone);
  const [data, orders, locale] = await Promise.all([getInventory(ctx, today), getPurchaseOrders(ctx), getLocale()]);
  const options = data.items.map((item) => ({ id: item.id, label: `${item.sku} · ${item.name}` }));
  const branchOptions = data.branches.filter((branch) => branch.active).map((branch) => ({ id: branch.id, label: branch.name }));

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />

      <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={t("stats.items")} value={data.items.length} icon={<BoxesIcon className="size-5" aria-hidden />} />
        <Stat label={t("stats.low")} value={data.lowStock.length} icon={<AlertTriangleIcon className="size-5" aria-hidden />} />
        <Stat label={t("stats.expiring")} value={data.expiring.length} icon={<CalendarClockIcon className="size-5" aria-hidden />} />
        <Stat label={t("stats.expired")} value={data.expired.length} icon={<PackageCheckIcon className="size-5" aria-hidden />} />
      </section>

      {(data.lowStock.length || data.expiring.length || data.expired.length) ? (
        <section className="mb-5 grid gap-3 lg:grid-cols-3" aria-label={t("alertsTitle")}>
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <h2 className="font-semibold">{t("lowStockTitle")}</h2>
            {data.lowStock.length ? <ul className="mt-2 space-y-1 text-sm">{data.lowStock.map((item) => <li key={item.id}><bdi>{item.name}</bdi> · {item.stock}/{item.minimumStock} {t(`units.${item.unit}`)}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">{t("none")}</p>}
          </div>
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <h2 className="font-semibold">{t("expiringTitle")}</h2>
            {data.expiring.length ? <ul className="mt-2 space-y-1 text-sm">{data.expiring.map((lot) => <li key={lot.id}><bdi>{lot.itemName}</bdi> · <bdi>{lot.lotNumber}</bdi> · {formatDateOnly(lot.expiresOn!)}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">{t("none")}</p>}
          </div>
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
            <h2 className="font-semibold text-destructive">{t("expiredTitle")}</h2>
            {data.expired.length ? <ul className="mt-2 space-y-1 text-sm">{data.expired.map((lot) => <li key={lot.id}><bdi>{lot.itemName}</bdi> · <bdi>{lot.lotNumber}</bdi> · {formatDateOnly(lot.expiresOn!)}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">{t("none")}</p>}
          </div>
        </section>
      ) : null}

      <InventoryForms items={options} branches={branchOptions} today={today} />
      <PurchaseOrderForm items={options} branches={branchOptions} today={today} currency={ctx.organization.defaultCurrency} />

      <section className="mb-5 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{t("orders.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("orders.hint")}</p>
        </div>
        {orders.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">{t("orders.empty")}</p> : (
          <ul className="divide-y">{orders.map((order) => {
            const totalMinor = order.lines.reduce((sum, line) => sum + (line.unitCostMinor ?? 0) * line.quantityOrdered, 0);
            return (
              <li key={order.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold"><bdi>{order.number}</bdi> · <bdi>{order.supplierName}</bdi></p><p className="text-xs text-muted-foreground"><bdi>{order.branchName}</bdi> · {formatDateOnly(order.orderedOn)}{order.expectedOn ? ` · ${t("orders.expectedShort", { date: formatDateOnly(order.expectedOn) })}` : ""}</p></div>
                  <div className="text-end"><Badge variant={order.status === "received" ? "secondary" : order.status === "cancelled" ? "destructive" : "outline"}>{t(`orders.status.${order.status}`)}</Badge>{totalMinor > 0 ? <p className="mt-1 text-sm font-medium tabular-nums" dir="auto">{formatMoney(totalMinor, ctx.organization.defaultCurrency, locale)}</p> : null}</div>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">{order.lines.map((line) => (
                  <div key={line.id} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-3 text-sm"><div><p className="font-medium"><bdi>{line.itemName}</bdi></p><p className="text-xs text-muted-foreground"><bdi>{line.sku}</bdi>{line.unitCostMinor !== null ? ` · ${formatMoney(line.unitCostMinor, line.currency, locale)}` : ""}</p></div><p className="text-end font-medium tabular-nums">{line.received}/{line.quantityOrdered} {t(`units.${line.unit}`)}</p></div>
                    {line.remaining > 0 && order.status !== "cancelled" ? <PurchaseOrderReceiptForm lineId={line.id} remaining={line.remaining} today={today} /> : null}
                  </div>
                ))}</div>
              </li>
            );
          })}</ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{t("stockTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("stockHint")}</p>
        </div>
        {data.items.length === 0 ? (
          <div className="p-10 text-center">
            <BoxesIcon className="mx-auto mb-3 size-9 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {data.items.map((item) => (
              <li key={item.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold"><bdi>{item.name}</bdi></p>
                    <p className="text-xs text-muted-foreground"><bdi>{item.sku}</bdi>{item.category ? <> · <bdi>{item.category}</bdi></> : null}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-xl font-semibold tabular-nums">{item.stock} <span className="text-sm font-normal text-muted-foreground">{t(`units.${item.unit}`)}</span></p>
                    {item.low ? <Badge variant="outline" className="border-warning/60 text-warning-foreground">{t("lowBadge", { minimum: item.minimumStock })}</Badge> : null}
                  </div>
                </div>
                {item.lots.length ? (
                  <div className="mt-3 overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[42rem] text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start">{t("lotNumber")}</th><th className="px-3 py-2 text-start">{t("branch")}</th><th className="px-3 py-2 text-start">{t("receivedOn")}</th><th className="px-3 py-2 text-start">{t("expiresOn")}</th><th className="px-3 py-2 text-end">{t("available")}</th></tr></thead>
                      <tbody className="divide-y">{item.lots.map((lot) => (
                        <tr key={lot.id} className={lot.balance <= 0 ? "text-muted-foreground" : undefined}>
                          <td className="px-3 py-2"><bdi>{lot.lotNumber}</bdi></td><td className="px-3 py-2"><bdi>{lot.branchName}</bdi></td><td className="px-3 py-2 tabular-nums">{formatDateOnly(lot.receivedOn)}</td><td className="px-3 py-2 tabular-nums">{lot.expiresOn ? formatDateOnly(lot.expiresOn) : "—"}</td><td className="px-3 py-2 text-end font-medium tabular-nums">{lot.balance}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="mt-2 text-sm text-muted-foreground">{t("noLots")}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
