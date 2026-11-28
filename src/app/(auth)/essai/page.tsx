import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_TRIAL_DAYS } from "@/lib/trial";
import { getSession } from "@/server/auth/context";
import { nodeRole } from "@/server/sync/node";
import { TrialForm } from "./trial-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("trial"))("title", { days: DEFAULT_TRIAL_DAYS }) };
}

const POINTS = ["agenda", "patients", "billing", "languages", "data"] as const;

/** Public "try it free" page: the request lands in the platform console (/platform). Not offered on a clinic computer. */
export default async function TrialPage() {
  if ((await nodeRole()) === "clinic") redirect("/login");
  if (await getSession()) redirect("/dashboard");
  const t = await getTranslations("trial");
  return <Card className="w-full max-w-2xl">
    <CardHeader>
      <CardTitle className="text-2xl">{t("title", { days: DEFAULT_TRIAL_DAYS })}</CardTitle>
      <CardDescription>{t("subtitle")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {POINTS.map((key) => <li key={key} className="flex items-start gap-2"><CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{t(`points.${key}`)}</li>)}
      </ul>
      <TrialForm />
      <p className="text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">{t("signIn")}</Link>
      </p>
    </CardContent>
  </Card>;
}
