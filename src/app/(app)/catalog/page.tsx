import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { InfoIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CatalogBrowser } from "@/features/catalog/components/catalog-browser";
import { listCatalog } from "@/features/catalog/server";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalog"))("title") };
}

export default async function CatalogPage({ searchParams }: PageProps<"/catalog">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "catalog.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const includeInactive = (await searchParams).inactive === "1";
  const categories = await listCatalog(ctx, { includeInactive });
  const hasDemo = categories.some((c) => c.services.some((s) => s.isDemoPrice));
  const currency = ctx.organization.defaultCurrency;

  return (
    <>
      <PageHeader title={t("catalog.title")} description={t("catalog.subtitle")} />
      {hasDemo ? (
        <Alert className="mb-4">
          <InfoIcon aria-hidden />
          <AlertDescription>{t("catalog.demoNotice")}</AlertDescription>
        </Alert>
      ) : null}
      <p className="mb-3 text-sm">
        <Link href={includeInactive ? "/catalog" : "/catalog?inactive=1"} className="text-primary hover:underline">
          {includeInactive ? t("catalog.title") : t("catalog.showInactive")}
        </Link>
      </p>
      <CatalogBrowser
        categories={categories}
        canManage={can(ctx, "catalog.manage")}
        currency={currency}
        currencySymbol={ctx.organization.settings.currencyDisplay ?? currency}
        timeZone={ctx.organization.timezone}
      />
    </>
  );
}
