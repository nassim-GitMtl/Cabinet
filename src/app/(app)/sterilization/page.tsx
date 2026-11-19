import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangleIcon, CheckCircle2Icon, Clock3Icon, ShieldCheckIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { CycleForm, SetupForms } from "@/features/sterilization/components/sterilization-forms";
import { getSterilizationDashboard } from "@/features/sterilization/server";
import { formatDateTime, timeInZone, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("sterilization"))("title") }; }

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><span className="text-primary">{icon}</span></div><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p></div>;
}

export default async function SterilizationPage() {
  const ctx = await requireClinicContext(); const t = await getTranslations("sterilization");
  const canManage = can(ctx, "sterilization.manage"); const canRelease = can(ctx, "sterilization.release");
  if (!canManage && !canRelease) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const data = await getSterilizationDashboard(ctx);
  const activeBranches = data.branches.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }));
  const activeMachines = data.sterilizers.filter((x) => x.sterilizer.isActive).map((x) => ({ value: x.sterilizer.id, label: x.sterilizer.name, branchId: x.sterilizer.branchId }));
  const activeSets = data.instrumentSets.filter((x) => x.isActive).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }));
  const count = (status: string) => data.cycles.filter((x) => x.cycle.status === status).length;
  return <>
    <PageHeader title={t("title")} description={t("subtitle")} />
    <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat label={t("status.pending_release")} value={count("pending_release")} icon={<Clock3Icon className="size-5" />} />
      <Stat label={t("status.released")} value={count("released")} icon={<CheckCircle2Icon className="size-5" />} />
      <Stat label={t("status.failed")} value={count("failed")} icon={<AlertTriangleIcon className="size-5" />} />
      <Stat label={t("status.recalled")} value={count("recalled")} icon={<ShieldCheckIcon className="size-5" />} />
    </section>
    {canManage ? <>
      <SetupForms branches={activeBranches} />
      {activeMachines.length && activeBranches.length ? <CycleForm branches={activeBranches} sterilizers={activeMachines} sets={activeSets} today={todayInZone(ctx.organization.timezone)} nowTime={timeInZone(new Date(), ctx.organization.timezone)} /> : <div className="mb-5 rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">{t("record.setupFirst")}</div>}
    </> : null}
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm"><div className="border-b px-4 py-3"><h2 className="font-semibold">{t("cycles.title")}</h2><p className="text-sm text-muted-foreground">{t("cycles.hint")}</p></div>
      {data.cycles.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">{t("cycles.empty")}</p> : <ul className="divide-y">{data.cycles.map(({ cycle, sterilizerName, branchName, packCount }) => <li key={cycle.id}><Link href={`/sterilization/cycles/${cycle.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-muted/40"><div><p className="font-semibold"><bdi>{cycle.reference}</bdi> · <bdi>{sterilizerName}</bdi></p><p className="text-xs text-muted-foreground"><bdi>{branchName}</bdi> · {formatDateTime(cycle.startedAt, ctx.organization.timezone)} · {t("packs.count", { count: packCount })}</p></div><Badge variant={cycle.status === "released" ? "secondary" : cycle.status === "failed" || cycle.status === "recalled" ? "destructive" : "outline"}>{t(`status.${cycle.status}`)}</Badge></Link></li>)}</ul>}
    </section>
  </>;
}
