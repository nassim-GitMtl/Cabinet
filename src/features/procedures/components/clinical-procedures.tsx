import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDaysIcon, StethoscopeIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { formatDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { ServiceSnapshot } from "@/server/db/schema";
import { ProcedureStatusActions } from "./procedure-status-actions";

type ProcedureRow = {
  id: string;
  encounterId: string;
  serviceId: string;
  serviceSnapshot: ServiceSnapshot;
  toothNumber: string | null;
  surfaces: string[];
  arch: "maxillary" | "mandibular" | null;
  quadrant: "upper_right" | "upper_left" | "lower_left" | "lower_right" | null;
  quantity: number;
  unitPriceMinor: number;
  currency: string;
  priceOverrideReason: string | null;
  serviceDate: string;
  status: "completed" | "reversed" | "entered_in_error";
  statusReason: string | null;
  createdAt: Date;
  providerName: string;
  providerTitle: string | null;
};

export async function ClinicalProcedures({
  patientId,
  procedures,
  canWrite,
  currencySymbol,
  created,
}: {
  patientId: string;
  procedures: ProcedureRow[];
  canWrite: boolean;
  currencySymbol: string;
  created: boolean;
}) {
  const t = await getTranslations("procedures");
  const locale = await getLocale();
  const intl = INTL_LOCALE[isLocale(locale) ? locale : "fr"];

  const nameOf = (snapshot: ServiceSnapshot) =>
    (snapshot.name as Record<string, string | undefined>)[locale] || snapshot.name.fr;
  const anatomyOf = (procedure: ProcedureRow) => {
    if (procedure.toothNumber) {
      const surfaces = procedure.surfaces.map((surface) => t(`surfaces.${surface as "mesial"}`)).join(", ");
      return `${t("toothShort", { tooth: procedure.toothNumber })}${surfaces ? ` · ${surfaces}` : ""}`;
    }
    if (procedure.arch) return t(`arches.${procedure.arch}`);
    if (procedure.quadrant) return t(`quadrants.${procedure.quadrant}`);
    return null;
  };

  return (
    <section className="space-y-4" aria-labelledby="procedures-heading">
      {created ? (
        <Alert>
          <AlertDescription>{t("createdSuccess")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="procedures-heading" className="font-semibold">{t("historyTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("historySubtitle")}</p>
        </div>
        {canWrite ? <ButtonLink href={`/patients/${patientId}/procedures/new`}>{t("add")}</ButtonLink> : null}
      </div>

      {procedures.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center">
          <StethoscopeIcon className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          {canWrite ? (
            <ButtonLink href={`/patients/${patientId}/procedures/new`} variant="outline" className="mt-4">
              {t("emptyCta")}
            </ButtonLink>
          ) : null}
        </div>
      ) : (
        <ol className="space-y-3">
          {procedures.map((procedure) => {
            const anatomy = anatomyOf(procedure);
            return (
              <li key={procedure.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium"><bdi>{nameOf(procedure.serviceSnapshot)}</bdi></h3>
                      <Badge variant={procedure.status === "completed" ? "outline" : "secondary"}>
                        {t(`status.${procedure.status}`)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <bdi>{procedure.serviceSnapshot.code}</bdi>
                      {anatomy ? ` · ${anatomy}` : ""}
                      {procedure.quantity > 1 ? ` · ${t("quantityShort", { quantity: procedure.quantity })}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-end font-semibold tabular">
                    {formatMoney(
                      procedure.unitPriceMinor * procedure.quantity,
                      procedure.currency,
                      intl,
                      currencySymbol,
                    )}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDaysIcon className="size-3.5" aria-hidden />
                    <time dateTime={procedure.serviceDate}>{formatDateOnly(procedure.serviceDate)}</time>
                  </span>
                  <span><bdi>{[procedure.providerTitle, procedure.providerName].filter(Boolean).join(" ")}</bdi></span>
                  {procedure.priceOverrideReason ? <span>{t("priceOverridden")}</span> : null}
                </div>
                {procedure.statusReason ? (
                  <p className="mt-2 rounded-md bg-muted px-2.5 py-2 text-xs" dir="auto">
                    <bdi>{procedure.statusReason}</bdi>
                  </p>
                ) : null}
                {procedure.status === "completed" && canWrite ? (
                  <div className="mt-3 border-t pt-3">
                    <ProcedureStatusActions procedureId={procedure.id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
