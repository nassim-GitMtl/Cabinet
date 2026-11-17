import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/button-link";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <div className="rounded-xl border border-dashed bg-card p-10 text-center">
      <h1 className="text-lg font-semibold">{t("notFoundTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("notFound")}</p>
      <ButtonLink href="/dashboard" variant="outline" className="mt-4">
        {t("backHome")}
      </ButtonLink>
    </div>
  );
}
