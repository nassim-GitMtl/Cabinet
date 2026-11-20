import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRightIcon, FileUpIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { SearchInput } from "@/components/app/search-input";
import { ButtonLink } from "@/components/button-link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { patientArabicName, patientDisplayName } from "@/features/patients/display";
import { searchPatients } from "@/features/patients/server";
import { formatDateOnly } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("patients"))("title") };
}

const STATUSES = ["active", "archived", "all"] as const;

export default async function PatientsPage({ searchParams }: PageProps<"/patients">) {
  const ctx = await requireClinicContext();
  const t = await getTranslations();
  if (!can(ctx, "patient.read")) return <ForbiddenState message={t("errors.forbiddenPage")} />;

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = STATUSES.find((s) => s === sp.status) ?? "active";
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await searchPatients(ctx, { q, status, page, pageSize: 25 });
  const country = ctx.organization.countryCode;

  const hrefWith = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    const merged = { q, status, page: String(page), ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "" && !(k === "status" && v === "active") && !(k === "page" && v === "1")) next.set(k, String(v));
    const s = next.toString();
    return `/patients${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title={t("patients.title")}
        description={t("common.results", { count: result.total })}
        actions={
          can(ctx, "patient.create") ? (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/patients/import" variant="outline">
                <FileUpIcon aria-hidden />
                {t("patientImport.button")}
              </ButtonLink>
              <ButtonLink href="/patients/new">
                <UserPlusIcon aria-hidden />
                {t("patients.new")}
              </ButtonLink>
            </div>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput placeholder={t("patients.searchPlaceholder")} label={t("common.search")} />
        <div role="tablist" aria-label={t("patients.columns.status")} className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
          {STATUSES.map((s) => (
            <Link
              key={s}
              role="tab"
              aria-selected={status === s}
              href={hrefWith({ status: s, page: null })}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors",
                status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`patients.filter.${s}`)}
            </Link>
          ))}
        </div>
      </div>

      {result.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <UsersIcon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{q ? t("patients.emptySearch", { q }) : t("patients.empty")}</p>
          {!q && can(ctx, "patient.create") ? (
            <ButtonLink href="/patients/new" className="mt-4">
              {t("patients.emptyCta")}
            </ButtonLink>
          ) : null}
        </div>
      ) : (
        <>
          {/* Mobile list */}
          <ul className="divide-y rounded-xl border bg-card md:hidden">
            {result.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/patients/${p.id}`} className="flex items-center gap-3 p-4 active:bg-accent">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{patientDisplayName(p)}</p>
                    {patientArabicName(p) ? (
                      <p className="truncate text-sm">
                        <bdi lang="ar">{patientArabicName(p)}</bdi>
                      </p>
                    ) : null}
                    <p className="truncate text-xs text-muted-foreground tabular">
                      {p.patientNumber}
                      {p.phone ? ` · ${formatPhone(p.phone, country)}` : ""}
                      {p.birthDate ? ` · ${formatDateOnly(p.birthDate)}` : ""}
                    </p>
                  </div>
                  {p.status !== "active" ? <Badge variant="secondary">{t(`patients.status.${p.status}`)}</Badge> : null}
                  <ChevronRightIcon className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t("patients.columns.number")}</TableHead>
                  <TableHead>{t("patients.columns.name")}</TableHead>
                  <TableHead>{t("patients.columns.phone")}</TableHead>
                  <TableHead>{t("patients.columns.birthDate")}</TableHead>
                  <TableHead>{t("patients.columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((p) => (
                  <TableRow key={p.id} className="relative">
                    <TableCell className="text-muted-foreground tabular">{p.patientNumber}</TableCell>
                    <TableCell>
                      <Link href={`/patients/${p.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                        {patientDisplayName(p)}
                      </Link>
                      {patientArabicName(p) ? (
                        <span className="ms-2 text-sm text-muted-foreground">
                          <bdi lang="ar">{patientArabicName(p)}</bdi>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular" dir="ltr">{formatPhone(p.phone, country)}</TableCell>
                    <TableCell className="tabular">{formatDateOnly(p.birthDate)}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "outline" : "secondary"}>{t(`patients.status.${p.status}`)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(n) => hrefWith({ page: n })} />
        </>
      )}
    </>
  );
}
