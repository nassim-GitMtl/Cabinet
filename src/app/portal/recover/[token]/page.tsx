import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalRecoveryForm } from "@/features/consent/components/portal-forms";
import { getPortalRecovery } from "@/server/portal/auth";

export default async function PortalRecoveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [recovery, t] = await Promise.all([getPortalRecovery(token), getTranslations("portal")]);
  return <Card className="mx-auto max-w-md">
    <CardHeader>
      <CardTitle>{t("recoveryPageTitle")}</CardTitle>
      <CardDescription>{recovery ? t("recoveryPageSubtitle", { clinic: recovery.clinicName }) : t("recoveryUnavailable")}</CardDescription>
    </CardHeader>
    {recovery ? <CardContent><p className="mb-5 text-sm"><bdi>{recovery.email}</bdi></p><PortalRecoveryForm token={token} /></CardContent> : null}
  </Card>;
}
