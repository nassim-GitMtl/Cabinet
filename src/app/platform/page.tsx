import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { ButtonLink } from "@/components/button-link";
import { PlatformConsole } from "@/features/platform/components/platform-console";
import { listPlatformClinics, listTrialRequests } from "@/features/platform/server";
import { requirePlatformOperator } from "@/server/auth/platform";

export default async function PlatformPage() {
  const ctx = await requirePlatformOperator();
  const [clinics, requests, t] = await Promise.all([listPlatformClinics(ctx), listTrialRequests(ctx), getTranslations("platform")]);
  return <div className="min-h-dvh bg-background">
    <header className="border-b bg-card"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><Link href="/dashboard" className="font-semibold">{t("brand")}</Link><div className="flex items-center gap-2"><LanguageSwitcher compact /><ButtonLink href="/dashboard" variant="outline" size="sm">{t("backToClinic")}</ButtonLink></div></div></header>
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><PlatformConsole clinics={clinics} requests={requests} now={new Date().toISOString()} /></main>
  </div>;
}
