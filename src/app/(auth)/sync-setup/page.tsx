import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AutoRefresh, PairComputerForm } from "@/features/sync/components/sync-forms";
import { nodeRole, nodeStatus } from "@/server/sync/node";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sync.setup"))("title"), robots: { index: false } };
}

/** On a clinic computer: pair with the online copy, follow the first copy, then sign in. */
export default async function SyncSetupPage() {
  const [t, all] = await Promise.all([getTranslations("sync.setup"), getTranslations()]);
  const isClinic = (await nodeRole()) === "clinic";
  const status = isClinic ? await nodeStatus() : null;
  const reason = status?.lastError && all.has(`sync.reasons.${status.lastError}` as never) ? all(`sync.reasons.${status.lastError}` as never) : null;
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{!status ? t("notClinic") : status.state === "unpaired" ? t("hint") : status.state === "active" ? t("done") : t("copyingHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.state === "unpaired" ? <PairComputerForm defaultUrl={process.env.CABINET_CLOUD_URL ?? ""} /> : null}
        {status?.state === "bootstrapping" ? <>
          <AutoRefresh />
          <p className="text-sm font-medium" role="status">
            {status.bootstrap?.total ? t("copying", { done: status.bootstrap.index ?? 0, total: status.bootstrap.total }) : t("waiting")}
          </p>
          {status.bootstrap?.total ? <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(((status.bootstrap.index ?? 0) / status.bootstrap.total) * 100)}%` }} /></div> : null}
          {reason ? <p className="text-sm text-destructive">{reason}</p> : null}
        </> : null}
        {status?.state === "active" || !status ? <Link href="/login" className="font-medium text-primary hover:underline">{t("login")}</Link> : null}
      </CardContent>
    </Card>
  );
}
