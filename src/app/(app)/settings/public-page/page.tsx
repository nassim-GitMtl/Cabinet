import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { PublicPageForm } from "@/features/public-page/components/public-page-form";
import { publicOrigin } from "@/features/public-page/origin";
import { getPublicPageSettings } from "@/features/public-page/server";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("publicPage"))("title") };
}

export default async function PublicPageSettings() {
  const ctx = await requireClinicContext();
  const t = await getTranslations("publicPage");
  if (!can(ctx, "org.settings.manage")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const [data, { origin, localOnly }, locale] = await Promise.all([getPublicPageSettings(ctx), publicOrigin(), getLocale()]);
  const p = data.profile;
  const name = (n: { fr: string; en?: string; ar?: string }) => (n as Record<string, string | undefined>)[locale] || n.fr;
  const price = (minor: number) => formatMoney(minor, ctx.organization.defaultCurrency, locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ", ctx.organization.settings.currencyDisplay);
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} back={<ButtonLink href="/settings" variant="ghost">← {(await getTranslations("settings"))("title")}</ButtonLink>} />
      <PublicPageForm
        origin={origin}
        localOnly={localOnly}
        branchPhone={data.branchPhone ? formatPhone(data.branchPhone) : ""}
        links={data.links.map((l) => ({ id: l.id, label: l.label }))}
        services={data.services.map((s) => ({ id: s.id, name: name(s.name), category: name(s.category), price: price(s.priceMinor) }))}
        saved={{
          slug: p?.slug ?? data.suggestedSlug,
          isPublished: p?.isPublished ?? false,
          about: p?.about ?? {},
          whatsappPhone: p?.whatsappPhone ? formatPhone(p.whatsappPhone) : "",
          mapUrl: p?.mapUrl ?? "",
          facebookUrl: p?.facebookUrl ?? "",
          instagramUrl: p?.instagramUrl ?? "",
          reviewUrl: data.reviewUrl,
          bookingLinkId: p?.bookingLinkId ?? "",
          featuredServiceIds: p?.featuredServiceIds ?? [],
          showPrices: p?.showPrices ?? false,
        }}
      />
    </>
  );
}
