import Image from "next/image";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/app/language-switcher";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations();
  return <div className="min-h-dvh bg-gradient-to-b from-primary/8 via-background to-background">
    <header className="border-b bg-background/90 px-4 py-3 backdrop-blur sm:px-8">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <span className="flex items-center gap-2 font-semibold"><Image src="/icon.svg" alt="" width={32} height={32} priority />{t("common.appName")} · {t("portal.title")}</span>
        <LanguageSwitcher compact />
      </div>
    </header>
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">{children}</main>
  </div>;
}
