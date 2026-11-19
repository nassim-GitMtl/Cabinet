import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { discardSterilizationPackAction, failSterilizationCycleAction, recallSterilizationCycleAction, recordBiologicalResultAction, releaseSterilizationCycleAction } from "@/features/sterilization/actions";
import { SterilizationActionForm } from "@/features/sterilization/components/action-form";
import { getSterilizationCycle } from "@/features/sterilization/server";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export default async function SterilizationCyclePage({ params }: PageProps<"/sterilization/cycles/[id]">) {
  const { id } = await params; const ctx = await requireClinicContext(); const t = await getTranslations("sterilization");
  const canManage = can(ctx, "sterilization.manage"); const canRelease = can(ctx, "sterilization.release");
  if (!canManage && !canRelease) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const data = await getSterilizationCycle(ctx, id); if (!data) notFound();
  const { cycle } = data;
  return <>
    <PageHeader title={`${t("cycles.cycle")} ${cycle.reference}`} description={`${data.sterilizerName} · ${data.branchName}`} back={<Link href="/sterilization" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4 rtl:rotate-180" />{t("title")}</Link>} actions={<ButtonLink href={`/print/sterilization/cycles/${cycle.id}`} variant="outline"><PrinterIcon />{t("actions.printLabels")}</ButtonLink>} />
    <section className="mb-5 grid gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><p className="text-xs text-muted-foreground">{t("fields.status")}</p><Badge className="mt-1" variant={cycle.status === "released" ? "secondary" : cycle.status === "pending_release" ? "outline" : "destructive"}>{t(`status.${cycle.status}`)}</Badge></div>
      <div><p className="text-xs text-muted-foreground">{t("fields.startedAt")}</p><p className="font-medium">{formatDateTime(cycle.startedAt, ctx.organization.timezone)}</p></div>
      <div><p className="text-xs text-muted-foreground">{t("fields.program")}</p><p className="font-medium"><bdi>{cycle.program}</bdi></p></div>
      <div><p className="text-xs text-muted-foreground">{t("fields.parameters")}</p><p className="font-medium" dir="auto">{[cycle.temperatureC && `${cycle.temperatureC} °C`, cycle.pressureBar && `${cycle.pressureBar} bar`, cycle.holdMinutes && `${cycle.holdMinutes} min`].filter(Boolean).join(" · ") || "—"}</p></div>
      {(["chemicalIndicator", "airRemovalTest", "biologicalIndicator"] as const).map((field) => <div key={field}><p className="text-xs text-muted-foreground">{t(`fields.${field}`)}</p><p className="font-medium">{t(`indicator.${cycle[field]}`)}</p></div>)}
      {cycle.decisionNote ? <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">{t("fields.decisionNote")}</p><p className="whitespace-pre-line"><bdi>{cycle.decisionNote}</bdi></p></div> : null}
      {cycle.recallReason ? <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">{t("fields.recallReason")}</p><p className="whitespace-pre-line text-destructive"><bdi>{cycle.recallReason}</bdi></p></div> : null}
    </section>
    {canRelease ? <section className="mb-5 grid gap-3 lg:grid-cols-3">
      {cycle.status === "pending_release" ? <><SterilizationActionForm action={releaseSterilizationCycleAction} hidden={{ cycleId: cycle.id }} label={t("actions.release")} /><SterilizationActionForm action={failSterilizationCycleAction} hidden={{ cycleId: cycle.id }} label={t("actions.fail")} requireReason destructive /></> : null}
      {cycle.status === "released" ? <SterilizationActionForm action={recallSterilizationCycleAction} hidden={{ cycleId: cycle.id }} label={t("actions.recall")} requireReason destructive /> : null}
      {cycle.biologicalIndicator === "pending" && (cycle.status === "pending_release" || cycle.status === "released") ? <SterilizationActionForm action={recordBiologicalResultAction} hidden={{ cycleId: cycle.id }} label={t("actions.recordBiological")} biological /> : null}
    </section> : null}
    <section className="mb-5 overflow-hidden rounded-2xl border bg-card shadow-sm"><div className="border-b px-4 py-3"><h2 className="font-semibold">{t("packs.title")}</h2></div>
      <ul className="divide-y">{data.packs.map(({ pack, setCode, setName }) => { const activeUse = data.uses.find((x) => x.use.packId === pack.id && !x.use.voidedAt); return <li key={pack.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono font-semibold" dir="ltr">{pack.code}</p><p className="text-sm"><bdi>{setCode ? `${setCode} · ${setName}` : pack.label}</bdi></p><p className="text-xs text-muted-foreground">{pack.expiresOn ? t("packs.expires", { date: formatDateOnly(pack.expiresOn) }) : t("packs.noExpiry")}</p></div><div className="text-end">{pack.discardedAt ? <Badge variant="destructive">{t("packs.discarded")}</Badge> : activeUse ? <Badge variant="secondary">{t("packs.used")}</Badge> : <Badge variant="outline">{t("packs.available")}</Badge>}</div></div>
        {activeUse ? <p className="mt-2 text-sm">{t("packs.usedBy")} <Link className="font-medium text-primary hover:underline" href={`/patients/${activeUse.use.patientId}/sterilization`}><bdi>{activeUse.firstName} {activeUse.lastName}</bdi> · {activeUse.patientNumber}</Link></p> : null}
        {canManage && !pack.discardedAt && !activeUse ? <div className="mt-3 max-w-md"><SterilizationActionForm action={discardSterilizationPackAction} hidden={{ packId: pack.id, cycleId: cycle.id }} label={t("actions.discard")} requireReason destructive /></div> : null}
      </li>; })}</ul>
    </section>
  </>;
}
