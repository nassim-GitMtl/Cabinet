import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { withTitle } from "@/features/activity/server";
import { pageFormat } from "@/features/billing/page-format";
import { ProviderProfileButton } from "@/features/honoraria/components/honoraria-forms";
import { PriceListRow } from "@/features/honoraria/components/price-list-row";
import { getProviderPriceList, listFeeProviders } from "@/features/honoraria/server";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("honoraria.priceList"))("title") };
}

/**
 * A practitioner's price list: for each service, his own price and his fee. The owner edits every practitioner's
 * list; a practitioner reads his own.
 */
export default async function PriceListPage({ searchParams }: PageProps<"/honoraires/tarifs">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  const manage = can(ctx, "honorarium.manage");
  if (!manage && !can(ctx, "honorarium.read.own")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sp = await searchParams;
  const providers = await listFeeProviders(ctx);
  const requested = typeof sp.doctor === "string" ? sp.doctor : "";
  const providerId = manage ? (providers.find((p) => p.id === requested)?.id ?? providers[0]?.id) : ctx.membershipId;
  if (!providerId || !providers.some((p) => p.id === providerId)) {
    return <ForbiddenState message={t("honoraria.priceList.noProvider")} />;
  }
  const [list, fmt] = await Promise.all([getProviderPriceList(ctx, providerId), pageFormat(ctx)]);
  const provider = providers.find((p) => p.id === providerId)!;
  const name = withTitle(provider.title, provider.displayName);
  const groups = new Map<string, { label: string; services: typeof list.services }>();
  for (const s of list.services) {
    const g = groups.get(s.categoryId) ?? { label: fmt.label(s.categoryName), services: [] };
    g.services.push(s);
    groups.set(s.categoryId, g);
  }

  return (
    <>
      <Link href="/honoraires" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("honoraria.title")}
      </Link>
      <PageHeader title={t("honoraria.priceList.titleFor", { name })} description={manage ? t("honoraria.priceList.description") : t("honoraria.priceList.readOnly")} />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        {manage && providers.length > 1 ? (
          <form method="get" className="flex items-end gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("honoraria.doctor")}
              <NativeSelect name="doctor" defaultValue={providerId}>
                {providers.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {withTitle(p.title, p.displayName)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <Button type="submit" variant="outline">{t("billing.apply")}</Button>
          </form>
        ) : null}
        <p className="text-sm">
          {t("honoraria.priceList.defaultRate", { rate: provider.defaultFeeRateBp / 100 })}
        </p>
        {manage ? <ProviderProfileButton provider={{ id: provider.id, name, specialty: provider.specialty, defaultFeeRateBp: provider.defaultFeeRateBp }} /> : null}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t("honoraria.priceList.explain")}</p>

      <div className="space-y-4">
        {[...groups.entries()].map(([id, g]) => (
          <section key={id} className="overflow-hidden rounded-xl border bg-card">
            <div className="hidden grid-cols-[minmax(0,1fr)_8rem_9rem_12rem_7rem] gap-2 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
              <span>{g.label}</span>
              <span>{t("honoraria.priceList.ownPrice")}</span>
              <span>{t("honoraria.priceList.feeType")}</span>
              <span>{t("honoraria.priceList.feeValue")}</span>
              <span className="text-end">{t("honoraria.priceList.perAct")}</span>
            </div>
            <h2 className="border-b bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground sm:hidden">{g.label}</h2>
            <div className="divide-y">
              {g.services.map((s) => (
                <PriceListRow
                  key={`${providerId}-${s.id}`}
                  providerId={providerId}
                  defaultRateBp={provider.defaultFeeRateBp}
                  symbol={fmt.symbol}
                  readOnly={!manage}
                  service={{
                    id: s.id,
                    code: s.code,
                    label: fmt.label(s.name),
                    priceMinor: s.priceMinor,
                    currency: s.currency,
                    isActive: s.isActive,
                    deductLabBeforeShare: s.deductLabBeforeShare,
                    ownPriceMinor: s.ownPriceMinor,
                    rule: s.rule,
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
