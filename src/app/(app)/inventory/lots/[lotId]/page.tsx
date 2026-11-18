import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DownloadIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getLotTrace } from "@/features/inventory/consumables";
import { formatDateOnly } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("inventory.lot"))("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function LotTracePage(props: PageProps<"/inventory/lots/[lotId]">) {
  const { lotId } = await props.params;
  const ctx = await requireClinicContext();
  const t = await getTranslations("inventory");
  if (!can(ctx, "inventory.manage") || !can(ctx, "patient.read")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  if (!UUID.test(lotId)) notFound();
  const [trace, locale] = await Promise.all([getLotTrace(ctx, lotId), getLocale()]);
  if (!trace) notFound();
  const name = (n: { fr: string; en?: string; ar?: string }) => (n as Record<string, string | undefined>)[locale] || n.fr;
  const received = trace.movements.filter((m) => m.quantityDelta > 0).reduce((s, m) => s + m.quantityDelta, 0);
  const patientCount = new Set(trace.patients.map((p) => p.patientId)).size;
  const unit = (n: number) => `${n} ${t(`units.${trace.unit}` as never)}`;

  return (
    <>
      <PageHeader
        title={t("lot.heading", { lot: trace.lot.lotNumber })}
        description={t("lot.subtitle", {
          item: `${trace.itemSku} · ${trace.itemName}`,
          expires: trace.lot.expiresOn ? formatDateOnly(trace.lot.expiresOn) : "—",
          received: formatDateOnly(trace.lot.receivedOn),
        })}
        back={<ButtonLink href="/inventory" variant="ghost">{t("consumables.backToInventory")}</ButtonLink>}
        actions={
          can(ctx, "report.export") && trace.patients.length ? (
            <a href={`/api/exports/lot?lot=${trace.lot.id}`} className={buttonVariants({ variant: "outline" })}>
              <DownloadIcon aria-hidden />
              {t("lot.export")}
            </a>
          ) : undefined
        }
      />

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("lot.received")} value={unit(received)} />
        <Stat label={t("lot.balance")} value={unit(trace.balance)} />
        <Stat label={t("lot.patients")} value={patientCount} />
        <Stat label={t("lot.untraced")} value={unit(trace.untracedUsage)} />
      </section>

      {trace.untracedUsage > 0 ? (
        <p className="mb-5 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t("lot.untracedHint")}</p>
      ) : null}

      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold">{t("lot.patientsTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("lot.patientsHint")}</p>
        {trace.patients.length ? (
          <div className="mt-4 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start">{t("lot.serviceDate")}</th>
                  <th className="px-3 py-2 text-start">{t("lot.patient")}</th>
                  <th className="px-3 py-2 text-start">{t("lot.phone")}</th>
                  <th className="px-3 py-2 text-start">{t("lot.procedure")}</th>
                  <th className="px-3 py-2 text-start">{t("lot.tooth")}</th>
                  <th className="px-3 py-2 text-start">{t("lot.provider")}</th>
                  <th className="px-3 py-2 text-end">{t("quantity")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {trace.patients.map((p) => (
                  <tr key={p.movementId}>
                    <td className="px-3 py-2 tabular-nums">{formatDateOnly(p.serviceDate)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/patients/${p.patientId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        <bdi>{p.lastName.toUpperCase()} {p.firstName}</bdi>
                      </Link>
                      <span className="block text-xs text-muted-foreground"><bdi>{p.patientNumber}</bdi></span>
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">{p.phone ? formatPhone(p.phone) : "—"}</td>
                    <td className="px-3 py-2"><bdi>{name(p.serviceSnapshot.name)}</bdi></td>
                    <td className="px-3 py-2 tabular-nums">{p.toothNumber ?? "—"}</td>
                    <td className="px-3 py-2"><bdi>{p.providerName}</bdi></td>
                    <td className="px-3 py-2 text-end tabular-nums">{-p.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t("lot.patientsEmpty")}</p>
        )}
      </section>
    </>
  );
}
