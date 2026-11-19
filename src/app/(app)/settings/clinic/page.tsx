import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ClinicIdentityForm, ClinicLogoForm } from "@/features/clinic-identity/components/clinic-identity-form";
import { getClinicIdentity } from "@/features/clinic-identity/server";
import { formatPhone } from "@/lib/phone";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clinicIdentity"))("title") };
}

export default async function ClinicIdentityPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations("clinicIdentity");
  if (!can(ctx, "org.settings.manage")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const data = await getClinicIdentity(ctx);
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} back={<ButtonLink href="/settings" variant="ghost">← {(await getTranslations("settings"))("title")}</ButtonLink>} />
      <div className="grid gap-5">
        <ClinicIdentityForm saved={{
          clinicName: data.clinicName,
          legalName: data.entity?.legalName ?? data.clinicName,
          address: data.entity?.address ?? data.branch?.address ?? "",
          identifiers: data.entity?.identifiers ?? {},
          phone: data.branch?.phone ? formatPhone(data.branch.phone) : "",
          email: data.branch?.email ?? "",
        }} />
        <ClinicLogoForm logoVersion={data.logo?.sha256.slice(0, 12) ?? null} />
      </div>
    </>
  );
}
