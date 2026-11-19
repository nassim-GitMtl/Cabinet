import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/app/page-header";
import { PrintButton } from "@/components/print/print-button";
import { Code128Barcode } from "@/features/sterilization/components/barcode";
import { getSterilizationCycle } from "@/features/sterilization/server";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export default async function PrintSterilizationLabelsPage({ params }: PageProps<"/print/sterilization/cycles/[id]">) {
  const { id } = await params; const ctx = await requireClinicContext(); const t = await getTranslations("sterilization");
  if (!can(ctx, "sterilization.manage") && !can(ctx, "sterilization.release")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const data = await getSterilizationCycle(ctx, id); if (!data) notFound();
  return <article><div className="no-print mb-4 flex justify-end"><PrintButton /></div><header className="mb-4"><h1 className="text-xl font-bold">{t("print.title")}</h1><p>{data.cycle.reference} · {data.sterilizerName} · {formatDateTime(data.cycle.startedAt, ctx.organization.timezone)}</p></header>
    <div className="grid grid-cols-2 gap-2">{data.packs.map(({ pack, setCode, setName }) => <section key={pack.id} className="avoid-break border border-neutral-400 p-2 text-center"><p className="text-xs font-semibold"><bdi>{setCode ? `${setCode} · ${setName}` : pack.label}</bdi></p><Code128Barcode value={pack.code} /><p className="text-[10px]">{t("print.cycle", { reference: data.cycle.reference })}{pack.expiresOn ? ` · ${t("print.expiry", { date: formatDateOnly(pack.expiresOn) })}` : ""}</p></section>)}</div>
  </article>;
}
