import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeftIcon, ScanLineIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { LinkPackForm, VoidPackUseForm } from "@/features/sterilization/components/patient-pack-form";
import { getPatientSterilization, lookupSterilizationPack } from "@/features/sterilization/server";
import { formatDateOnly, formatDateTime, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export default async function PatientSterilizationPage({ params, searchParams }: PageProps<"/patients/[id]/sterilization">) {
  const { id } = await params; const sp = await searchParams; const ctx = await requireClinicContext(); const t = await getTranslations("sterilization"); const locale = await getLocale();
  if (!can(ctx, "sterilization.manage") || !can(ctx, "patient.read")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const data = await getPatientSterilization(ctx, id); if (!data) notFound();
  const code = typeof sp.code === "string" ? sp.code.trim() : ""; const lookup = code ? await lookupSterilizationPack(ctx, code) : null; const today = todayInZone(ctx.organization.timezone);
  const procedures = data.procedures.map((row) => ({ value: row.id, label: `${formatDateOnly(row.serviceDate)} · ${row.snapshot.name[locale as "fr" | "en" | "ar"] || row.snapshot.name.fr || row.snapshot.code}` }));
  const usable = lookup && lookup.cycle.status === "released" && !lookup.pack.discardedAt && !lookup.activeUse && (!lookup.pack.expiresOn || lookup.pack.expiresOn >= today);
  return <>
    <PageHeader title={t("patient.title")} description={`${data.patient.firstName} ${data.patient.lastName} · ${data.patient.patientNumber}`} back={<Link href={`/patients/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4 rtl:rotate-180" />{t("patient.back")}</Link>} />
    <section className="mb-5 rounded-2xl border bg-card p-4 shadow-sm"><h2 className="font-semibold">{t("patient.scanTitle")}</h2><p className="text-sm text-muted-foreground">{t("patient.scanHint")}</p><form method="get" className="mt-3 flex flex-wrap gap-2"><label className="sr-only" htmlFor="pack-code">{t("patient.code")}</label><input id="pack-code" name="code" defaultValue={code} autoFocus autoComplete="off" className="h-10 min-w-60 flex-1 rounded-lg border bg-background px-3 font-mono" placeholder="ST-2026-000001" /><button className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit"><ScanLineIcon className="size-4" />{t("actions.lookup")}</button></form>
      {code && !lookup ? <p className="mt-3 text-sm text-destructive">{t("patient.notFound")}</p> : null}
      {lookup ? <div className="mt-4 rounded-xl border p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono font-semibold" dir="ltr">{lookup.pack.code}</p><p><bdi>{lookup.setCode ? `${lookup.setCode} · ${lookup.setName}` : lookup.pack.label}</bdi></p><p className="text-xs text-muted-foreground">{t("patient.cycle", { reference: lookup.cycle.reference, date: formatDateTime(lookup.cycle.startedAt, ctx.organization.timezone) })}</p></div><Badge variant={usable ? "secondary" : "destructive"}>{usable ? t("packs.available") : t("patient.unavailable")}</Badge></div>{usable ? <LinkPackForm packId={lookup.pack.id} patientId={id} usedOn={today} procedures={procedures} /> : null}</div> : null}
    </section>
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm"><div className="border-b px-4 py-3"><h2 className="font-semibold">{t("patient.history")}</h2></div>{data.uses.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">{t("patient.empty")}</p> : <ul className="divide-y">{data.uses.map(({ use, pack, cycle, setCode, setName }) => <li key={use.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono font-semibold" dir="ltr">{pack.code}</p><p className="text-sm"><bdi>{setCode ? `${setCode} · ${setName}` : pack.label}</bdi></p><p className="text-xs text-muted-foreground">{formatDateOnly(use.usedOn)} · {t("patient.cycleRef", { reference: cycle.reference })}</p></div>{use.voidedAt ? <Badge variant="destructive">{t("patient.voided")}</Badge> : <Badge variant="secondary">{t("packs.used")}</Badge>}</div>{!use.voidedAt ? <VoidPackUseForm useId={use.id} /> : use.voidReason ? <p className="mt-2 text-xs text-muted-foreground"><bdi>{use.voidReason}</bdi></p> : null}</li>)}</ul>}</section>
  </>;
}
