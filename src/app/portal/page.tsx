import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConsentDecisionButtons, LogoutButton, RevokeGrantForm } from "@/features/consent/components/portal-forms";
import { listPatientConsents } from "@/features/consent/portal";
import { requirePatientSession } from "@/server/portal/session";

export default async function PortalPage() {
  const ctx = await requirePatientSession();
  const [data, t] = await Promise.all([listPatientConsents(ctx), getTranslations("portal")]);
  const pending = data.requests.filter((r) => r.status === "awaiting_patient" && r.expiresAt > new Date());
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{t("dashboardTitle")}</h1><p className="text-sm text-muted-foreground"><bdi>{ctx.email}</bdi> · {t("dashboardSubtitle")}</p></div><LogoutButton /></header>
    <section><h2 className="mb-3 text-lg font-semibold">{t("pendingRequests")}</h2><div className="grid gap-4">
      {pending.map((request) => <Card key={request.id} className="border-primary/30"><CardHeader><div className="flex justify-between gap-3"><CardTitle className="text-base"><bdi>{data.organizations[request.requestingOrganizationId] ?? t("clinic")}</bdi></CardTitle><Badge>{t("decisionRequired")}</Badge></div><CardDescription><bdi>{request.purpose}</bdi></CardDescription></CardHeader><CardContent>
        <p className="text-sm font-medium">{t("scope")}</p><p className="mt-1 text-sm text-muted-foreground">{request.requestedScope.categories.map((c) => t(`category.${c}`)).join(" · ")}</p>
        <p className="mt-2 text-xs text-muted-foreground">{request.requestedScope.includeFutureUpdates ? t("includesFuture") : t("noFuture")}</p>
        <ConsentDecisionButtons requestId={request.id} />
      </CardContent></Card>)}
      {pending.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t("noPending")}</CardContent></Card> : null}
    </div></section>
    <section><h2 className="mb-3 text-lg font-semibold">{t("approvedGrants")}</h2><div className="grid gap-4 sm:grid-cols-2">
      {data.grants.map((grant) => <Card key={grant.id}><CardHeader><div className="flex justify-between gap-2"><CardTitle className="text-base"><bdi>{data.organizations[grant.receivingOrganizationId] ?? t("clinic")}</bdi></CardTitle><Badge variant="secondary">{t(`status.${grant.status}`)}</Badge></div><CardDescription><bdi>{grant.purpose}</bdi></CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{grant.categories.map((c) => t(`category.${c}`)).join(" · ")}</p>{grant.status === "active" ? <RevokeGrantForm grantId={grant.id} /> : null}</CardContent></Card>)}
      {data.grants.length === 0 ? <p className="text-sm text-muted-foreground">{t("noGrants")}</p> : null}
    </div></section>
  </div>;
}
