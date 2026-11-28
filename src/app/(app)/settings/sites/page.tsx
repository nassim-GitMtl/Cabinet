import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MapPinIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { SiteActiveButton, SiteButton } from "@/features/sites/components/site-forms";
import { listSites } from "@/features/sites/server";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sites"))("title") };
}

/** Sites of the clinic group. Adding a site needs the multi-site module (branches.manage). */
export default async function SitesPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "org.settings.manage")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const sites = await listSites(ctx);
  const multi = can(ctx, "branches.manage");

  return (
    <>
      <PageHeader
        title={t("sites.title")}
        description={multi ? t("sites.subtitle") : t("sites.singleSubtitle")}
        back={<ButtonLink href="/settings" variant="ghost">← {t("settings.title")}</ButtonLink>}
        actions={multi ? <SiteButton /> : null}
      />
      <ul className="space-y-3">
        {sites.map((s) => (
          <li key={s.id} className={cn("flex flex-wrap items-start gap-3 rounded-xl border bg-card p-4", !s.isActive && "opacity-60")}>
            <MapPinIcon className="mt-0.5 size-5 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-medium">
                <bdi>{s.name}</bdi>
                {s.isMain ? <Badge variant="outline" className="ms-2">{t("sites.main")}</Badge> : null}
                {!s.isActive ? <Badge variant="outline" className="ms-2">{t("sites.closed")}</Badge> : null}
              </p>
              {s.address ? <p className="text-sm text-muted-foreground"><bdi>{s.address}</bdi></p> : null}
              <p className="text-sm text-muted-foreground" dir="ltr">{[s.phone ? formatPhone(s.phone, ctx.organization.countryCode) : null, s.email].filter(Boolean).join(" · ") || "—"}</p>
            </div>
            <div className="flex gap-1">
              <SiteButton site={{ id: s.id, name: s.name, address: s.address, phone: s.phone, email: s.email, phoneDisplay: s.phone ? formatPhone(s.phone, ctx.organization.countryCode) : "" }} />
              {multi && sites.length > 1 ? <SiteActiveButton siteId={s.id} active={s.isActive} /> : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted-foreground">{t("sites.explain")}</p>
      {!multi ? <p className="mt-2 text-sm text-muted-foreground">{t("sites.moduleHint")}</p> : null}
    </>
  );
}
