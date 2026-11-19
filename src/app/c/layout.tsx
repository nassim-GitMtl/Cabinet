import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/app/language-switcher";

/** Public clinic page: no account, no patient data. */
export default async function ClinicPublicLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("booking");
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-accent/50 to-background">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Image src="/icon.svg" alt="" width={28} height={28} />
          {t("poweredBy")}
        </span>
        <LanguageSwitcher compact />
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16">{children}</main>
    </div>
  );
}
