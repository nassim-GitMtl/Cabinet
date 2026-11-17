"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ClipboardListIcon, PlusIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { formatMoney } from "@/lib/money";

type Plan = {
  id: string; status: "draft" | "proposed" | "accepted" | "declined" | "completed" | "cancelled";
  currentVersion: number; title: string; totalMinor: number; currency: string; updatedAt: Date;
};

export function TreatmentPlansPanel({ patientId, plans, canManage, currencySymbol }: { patientId: string; plans: Plan[]; canManage: boolean; currencySymbol: string }) {
  const t = useTranslations("treatmentPlans");
  const locale = useLocale();
  const intl = INTL_LOCALE[isLocale(locale) ? locale : "fr"];
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{t("title")}</h2><p className="text-sm text-muted-foreground">{t("subtitle")}</p></div>
      {canManage ? <ButtonLink href={`/patients/${patientId}/treatment-plans/new`}><PlusIcon aria-hidden />{t("new")}</ButtonLink> : null}
    </div>
    {plans.length === 0 ? <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
      <ClipboardListIcon className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">{t("empty")}</p><p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
    </div> : <ul className="grid gap-3">
      {plans.map((plan) => <li key={plan.id}>
        <Link href={`/patients/${patientId}/treatment-plans/${plan.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><bdi className="font-semibold">{plan.title}</bdi><Badge variant={plan.status === "accepted" ? "default" : "secondary"}>{t(`status.${plan.status}`)}</Badge></div>
            <p className="mt-1 text-xs text-muted-foreground">{t("version", { version: plan.currentVersion })} · {new Intl.DateTimeFormat(intl, { dateStyle: "medium" }).format(new Date(plan.updatedAt))}</p></div>
          <strong className="tabular">{formatMoney(plan.totalMinor, plan.currency, intl, currencySymbol)}</strong>
        </Link>
      </li>)}
    </ul>}
  </section>;
}
