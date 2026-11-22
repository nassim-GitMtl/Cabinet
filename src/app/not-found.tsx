import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/button-link";

/** Unknown address anywhere outside the signed-in app (that one has its own not-found page). */
export default async function NotFound() {
  const [t, common] = await Promise.all([getTranslations("errors"), getTranslations("common")]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-accent/60 to-background p-6 text-center">
      <Image src="/icon.svg" alt="" width={48} height={48} priority />
      <p className="mt-4 text-sm font-medium text-muted-foreground">{common("appName")}</p>
      <h1 className="mt-2 font-heading text-2xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t("pageNotFound")}</p>
      <ButtonLink href="/" className="mt-6">{t("backToStart")}</ButtonLink>
    </main>
  );
}
