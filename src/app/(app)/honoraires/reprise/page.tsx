import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, CheckCircle2Icon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageFormat } from "@/features/billing/page-format";
import { AssignLineForm } from "@/features/honoraria/components/honoraria-forms";
import { listFeeProviders, listFeeTerms, listUnassignedLines } from "@/features/honoraria/server";
import { formatDateOnly, parseDateOnly, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("honoraria.assign"))("title") };
}

/** Issued invoice lines without a practitioner fee entry (billed before fees were tracked): assign them one by one. */
export default async function AssignOldLinesPage({ searchParams }: PageProps<"/honoraires/reprise">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "honorarium.manage")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sp = await searchParams;
  const today = todayInZone(ctx.organization.timezone);
  let from = parseDateOnly(typeof sp.from === "string" ? sp.from : "") ?? `${today.slice(0, 4)}-01-01`;
  let to = parseDateOnly(typeof sp.to === "string" ? sp.to : "") ?? today;
  if (from > to) [from, to] = [to, from];
  const [lines, providers, terms, fmt] = await Promise.all([listUnassignedLines(ctx, { from, to }), listFeeProviders(ctx), listFeeTerms(ctx), pageFormat(ctx)]);
  const active = providers
    .filter((p) => p.status === "active")
    .map((p) => ({ id: p.id, name: [p.title, p.displayName].filter(Boolean).join(" "), defaultFeeRateBp: p.defaultFeeRateBp }));
  const ruleTerms = terms.map((x) => ({ providerId: x.providerId, serviceId: x.serviceId, ruleType: x.ruleType, ruleValue: x.ruleValue }));

  return (
    <>
      <Link href="/honoraires" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t("honoraria.title")}
      </Link>
      <PageHeader title={t("honoraria.assign.title")} description={t("honoraria.assign.description")} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("billing.from")}
          <Input type="date" name="from" defaultValue={from} max={today} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("billing.to")}
          <Input type="date" name="to" defaultValue={to} max={today} />
        </label>
        <Button type="submit" variant="outline">{t("billing.apply")}</Button>
      </form>
      {lines.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <CheckCircle2Icon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("honoraria.assign.empty")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {lines.map((line) => (
            <li key={line.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  <bdi>{line.description.code} · {fmt.label(line.description.name)}</bdi>
                </p>
                <span className="font-semibold tabular">{fmt.money(line.unitPriceMinor * line.quantity - line.discountMinor, line.currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDateOnly(line.serviceDate)} · {line.invoiceNumber} · <bdi>{line.patientFirstName} {line.patientLastName}</bdi>
              </p>
              <AssignLineForm
                line={{
                  id: line.id,
                  serviceId: line.serviceId ?? "",
                  currency: line.currency,
                  unitPriceMinor: line.unitPriceMinor,
                  quantity: line.quantity,
                  discountMinor: line.discountMinor,
                  deductLabBeforeShare: line.deductLabBeforeShare ?? false,
                  providerId: line.providerId ?? "",
                }}
                providers={active}
                terms={ruleTerms}
                symbol={fmt.symbol}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
