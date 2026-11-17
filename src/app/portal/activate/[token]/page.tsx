import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalActivationForm } from "@/features/consent/components/portal-forms";
import { getPortalInvitation } from "@/server/portal/auth";

export default async function PortalActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, t] = await Promise.all([getPortalInvitation(token), getTranslations("portal")]);
  return <Card className="mx-auto max-w-md">
    <CardHeader><CardTitle>{t("activateTitle")}</CardTitle><CardDescription>{invite ? t("activateSubtitle", { clinic: invite.clinicName }) : t("inviteUnavailable")}</CardDescription></CardHeader>
    {invite ? <CardContent><p className="mb-5 text-sm"><bdi>{invite.email}</bdi></p><PortalActivationForm token={token} /></CardContent> : null}
  </Card>;
}
