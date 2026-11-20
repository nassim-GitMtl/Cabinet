import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/features/access/components/password-forms";
import { getStaffPasswordReset } from "@/server/auth/password-reset";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("passwordReset"))("resetTitle"), robots: { index: false } };
}

export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  const [reset, t] = await Promise.all([getStaffPasswordReset(token), getTranslations("passwordReset")]);
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("resetTitle")}</CardTitle>
        <CardDescription>{reset ? (reset.clinicName ? t("resetSubtitleClinic", { clinic: reset.clinicName }) : t("resetSubtitle")) : t("unavailable")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reset ? <>
          <p className="text-sm"><bdi className="font-medium">{reset.fullName}</bdi> · <bdi className="text-muted-foreground">{reset.email}</bdi></p>
          {reset.resetMfa ? <p className="rounded-lg bg-warning/10 p-3 text-xs">{t("mfaWillReset")}</p> : null}
          <p className="text-xs text-muted-foreground">{t("signOutEverywhere")}</p>
          <ResetPasswordForm token={token} />
        </> : <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">{t("askAgain")}</Link>}
      </CardContent>
    </Card>
  );
}
