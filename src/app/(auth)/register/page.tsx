import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_TRIAL_DAYS } from "@/lib/trial";
import { getSession } from "@/server/auth/context";
import { isRegistrationAllowed } from "@/server/deployment/registration";
import { nodeRole } from "@/server/sync/node";
import { RegisterForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth"))("registerTitle") };
}

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard");
  const t = await getTranslations("auth");
  if (!(await isRegistrationAllowed())) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{t("registerTitle")}</CardTitle>
          <CardDescription>{t("registrationClosed")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(await nodeRole()) !== "clinic" ? (
            <Link href="/essai" className="block rounded-lg border border-primary/30 bg-primary/5 p-3 text-center text-sm font-medium text-primary hover:underline">
              {t("trialLink", { days: DEFAULT_TRIAL_DAYS })}
            </Link>
          ) : null}
          <Link href="/login" className="font-medium text-primary hover:underline">{t("signIn")}</Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">{t("registerTitle")}</CardTitle>
        <CardDescription>{t("registerSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {(await nodeRole()) === "clinic" ? (
          <Link href="/sync-setup" className="block rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm font-medium text-primary hover:underline">
            {(await getTranslations("sync.setup"))("registerLink")}
          </Link>
        ) : null}
        <RegisterForm />
        <p className="text-center text-sm text-muted-foreground">
          {t("haveAccount")}{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t("signIn")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
