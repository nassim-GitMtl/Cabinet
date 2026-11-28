import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_TRIAL_DAYS } from "@/lib/trial";
import { getSession } from "@/server/auth/context";
import { nodeRole } from "@/server/sync/node";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth"))("loginTitle") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/dashboard");
  const [t, query, role] = await Promise.all([getTranslations("auth"), searchParams, nodeRole()]);
  const notice = query.reset === "1" ? t("passwordChanged") : query.invited === "1" ? t("invitationAccepted") : null;
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {notice ? <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm" role="status">{notice}</p> : null}
        <LoginForm />
        <p className="-mt-3 text-center text-sm">
          <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground hover:underline">{t("forgotPassword")}</Link>
        </p>
        <p className="text-center text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            {t("registerLink")}
          </Link>
        </p>
        {role !== "clinic" ? (
          <Link href="/essai" className="block rounded-lg border border-primary/30 bg-primary/5 p-3 text-center text-sm font-medium text-primary hover:underline">
            {t("trialLink", { days: DEFAULT_TRIAL_DAYS })}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
