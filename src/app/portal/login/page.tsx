import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalLoginForm } from "@/features/consent/components/portal-forms";
import { readPatientSession } from "@/server/portal/session";

export default async function PortalLoginPage() {
  if (await readPatientSession()) redirect("/portal");
  const t = await getTranslations("portal");
  return <Card className="mx-auto max-w-md">
    <CardHeader><CardTitle>{t("loginTitle")}</CardTitle><CardDescription>{t("loginSubtitle")}</CardDescription></CardHeader>
    <CardContent><PortalLoginForm /></CardContent>
  </Card>;
}
