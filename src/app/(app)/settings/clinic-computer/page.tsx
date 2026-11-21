import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeftIcon, MonitorSmartphoneIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { PairingCodeForm, UnpairForm } from "@/features/sync/components/sync-forms";
import { getClinicNode } from "@/features/sync/server";
import { publicOrigin } from "@/features/public-page/origin";
import { requireClinicContext } from "@/server/auth/context";
import { nodeRole, nodeStatus } from "@/server/sync/node";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sync.settings"))("title") };
}

export default async function ClinicComputerPage() {
  const ctx = await requireClinicContext();
  const [t, all, format] = await Promise.all([getTranslations("sync.settings"), getTranslations(), getFormatter()]);
  if (!ctx.canManageClinicComputer) return <ForbiddenState message={all("errors.forbiddenPage")} />;
  const now = new Date();
  const when = (d: Date | null) => (d ? format.relativeTime(d, now) : t("never"));
  const back = <Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4 rtl:rotate-180" />{all("settings.title")}</Link>;

  if ((await nodeRole()) === "clinic") {
    const status = await nodeStatus();
    return <>{back}<PageHeader title={t("clinicTitle")} description={t("subtitle")} />
      <section className="max-w-2xl space-y-2 rounded-2xl border bg-card p-5 text-sm">
        {status.cloudUrl ? <p>{t("clinicLinked", { url: status.cloudUrl })}</p> : null}
        <p>{t("lastPush", { when: when(status.lastPushAt) })}</p>
        <p>{t("lastPull", { when: when(status.lastPullAt) })}</p>
        <p className={status.lastError ? "font-medium text-destructive" : "font-medium text-success"}>
          {status.lastError ? t("problem", { reason: all.has(`sync.reasons.${status.lastError}` as never) ? all(`sync.reasons.${status.lastError}` as never) : status.lastError }) : t("ok")}
        </p>
      </section>
    </>;
  }

  const { dataHome, node } = await getClinicNode(ctx);
  const { origin } = await publicOrigin();
  return <>{back}<PageHeader title={t("title")} description={t("subtitle")} />
    <div className="grid max-w-3xl gap-5">
      <section className="space-y-2 rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
        <MonitorSmartphoneIcon className="size-6 text-primary" aria-hidden />
        <p>{t("how1")}</p><p>{t("how2")}</p><p>{t("how3")}</p>
      </section>
      {node?.pairedAt && dataHome === "clinic" ? <>
        <section className="space-y-1 rounded-2xl border bg-card p-5 text-sm">
          <p className="font-medium"><bdi>{t("paired", { label: node.label, date: format.dateTime(node.pairedAt, { dateStyle: "long" }) })}</bdi></p>
          <p className="text-muted-foreground">{node.lastSeenAt ? t("lastSeen", { when: when(node.lastSeenAt) }) : t("neverSeen")}</p>
        </section>
        <section className="rounded-2xl border border-destructive/30 bg-card p-5"><UnpairForm /></section>
      </> : <section className="space-y-3 rounded-2xl border bg-card p-5">
        {node && !node.pairedAt && node.pairingExpiresAt && node.pairingExpiresAt > now
          ? <p className="text-sm text-muted-foreground">{t("pending", { time: format.dateTime(node.pairingExpiresAt, { hour: "2-digit", minute: "2-digit" }) })}</p> : null}
        <PairingCodeForm cloudUrl={origin} />
      </section>}
    </div>
  </>;
}
