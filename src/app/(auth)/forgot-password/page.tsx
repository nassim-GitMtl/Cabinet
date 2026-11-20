import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/features/access/components/password-forms";
import { passwordEmailEnabled } from "@/server/mail";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("passwordReset"))("forgotTitle") };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("passwordReset");
  const byEmail = passwordEmailEnabled();
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("forgotTitle")}</CardTitle>
        <CardDescription>{byEmail ? t("forgotByEmail") : t("forgotNoEmail")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {byEmail ? <ForgotPasswordForm /> : null}
        <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
          <p>{t("askAdmin")}</p>
          <p className="text-xs text-muted-foreground">{t("ownerHelp")}</p>
        </div>
        <p className="text-center text-sm"><Link href="/login" className="font-medium text-primary hover:underline">{t("backToLogin")}</Link></p>
      </CardContent>
    </Card>
  );
}
