import { getTranslations } from "next-intl/server";
import ar from "../../../../../messages/ar.json";
import fr from "../../../../../messages/fr.json";
import { ForbiddenState } from "@/components/app/page-header";
import { PrintButton } from "@/components/print/print-button";
import { publicOrigin } from "@/features/public-page/origin";
import { qrSvg } from "@/features/public-page/qr";
import { getPublicPageSettings } from "@/features/public-page/server";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

/** A4 poster for the waiting room / storefront: French and Arabic side by side, whatever the user's language. */
export default async function PublicPosterPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations("publicPage");
  if (!can(ctx, "org.settings.manage")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const [data, { origin, localOnly }] = await Promise.all([getPublicPageSettings(ctx), publicOrigin()]);
  const p = data.profile;
  const target = p?.isPublished ? `${origin}/c/${p.slug}` : data.links[0] ? `${origin}/book/${data.links[0].token}` : null;
  if (!target) return <p className="p-6">{t("posterUnavailable")}</p>;
  const svg = await qrSvg(target);
  const phone = p?.whatsappPhone ?? data.branchPhone;
  const pf = fr.publicPage.poster;
  const pa = ar.publicPage.poster;

  return (
    <article className="flex min-h-[270mm] flex-col items-center justify-between gap-6 border-[3px] border-black p-10 text-center">
      <div className="no-print flex w-full items-center justify-between gap-4 text-start">
        <p className="text-sm">{localOnly ? t("localOnly") : t("posterHint")}</p>
        <PrintButton />
      </div>
      <header>
        <h1 className="text-4xl font-bold"><bdi>{ctx.organization.name}</bdi></h1>
      </header>
      <div className="grid w-full grid-cols-2 gap-8">
        <div lang="fr" dir="ltr">
          <p className="text-3xl font-bold">{pf.headline}</p>
          <p className="mt-2 text-lg">{pf.scan}</p>
        </div>
        <div lang="ar" dir="rtl">
          <p className="text-3xl font-bold">{pa.headline}</p>
          <p className="mt-2 text-lg">{pa.scan}</p>
        </div>
      </div>
      <div className="w-[120mm] max-w-full [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="break-all font-mono text-base" dir="ltr">{target.replace(/^https?:\/\//, "")}</p>
      {phone ? (
        <div className="grid w-full grid-cols-2 gap-8 text-xl">
          <p lang="fr" dir="ltr">{pf.call} <span className="font-bold">{formatPhone(phone)}</span></p>
          <p lang="ar" dir="rtl">{pa.call} <span className="font-bold" dir="ltr">{formatPhone(phone)}</span></p>
        </div>
      ) : null}
    </article>
  );
}
