import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, ClipboardCheckIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { CheckoutForm } from "@/features/billing/components/checkout-form";
import { pageFormat } from "@/features/billing/page-format";
import { listUnbilledProcedures } from "@/features/billing/server";
import { patientDisplayName } from "@/features/patients/display";
import { getPatient } from "@/features/patients/server";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("checkoutTitle") };
}

export default async function CheckoutPage({ params }: PageProps<"/patients/[id]/billing/new">) {
  const { id } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "invoice.create")) return <ForbiddenState message={t("errors.forbiddenPage")} />;
  const data = await getPatient(ctx, id);
  if (!data) notFound();
  const [items, fmt] = await Promise.all([listUnbilledProcedures(ctx, id), pageFormat(ctx)]);

  return (
    <>
      <Link href={`/patients/${id}?tab=finance`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        <bdi>{patientDisplayName(data.patient)}</bdi>
      </Link>
      <PageHeader title={t("billing.checkoutTitle")} description={t("billing.checkoutSubtitle")} />
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center">
          <ClipboardCheckIcon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("billing.unbilledEmpty")}</p>
          {can(ctx, "clinical.write") ? (
            <ButtonLink href={`/patients/${id}/procedures/new`} className="mt-4">
              {t("procedures.add")}
            </ButtonLink>
          ) : null}
        </div>
      ) : (
        <CheckoutForm
          patientId={id}
          symbol={fmt.symbol}
          canIssue={can(ctx, "invoice.issue")}
          items={items.map((i) => ({
            id: i.id,
            code: i.serviceSnapshot.code,
            name: i.serviceSnapshot.name,
            toothNumber: i.toothNumber,
            quantity: i.quantity,
            amountMinor: i.quantity * i.unitPriceMinor,
            currency: i.currency,
            serviceDate: i.serviceDate,
            provider: [i.providerTitle, i.providerName].filter(Boolean).join(" "),
          }))}
        />
      )}
    </>
  );
}
