import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StaffInvitationForm } from "@/features/access/components/invitation-form";
import { getStaffInvitation } from "@/features/access/invitation";

export default async function StaffActivationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, t] = await Promise.all([getStaffInvitation(token), getTranslations("access")]);
  return <div className="grid min-h-dvh place-items-center bg-gradient-to-b from-accent/60 to-background p-4"><Card className="w-full max-w-md"><CardHeader><CardTitle>{t("joinTitle")}</CardTitle><CardDescription>{invite ? t("joinSubtitle", { clinic: invite.organizationName }) : t("invitationUnavailable")}</CardDescription></CardHeader>
    {invite ? <CardContent><p className="mb-4 text-sm"><bdi>{invite.email}</bdi></p><StaffInvitationForm token={token} existingUser={invite.existingUser} /></CardContent> : null}
  </Card></div>;
}
