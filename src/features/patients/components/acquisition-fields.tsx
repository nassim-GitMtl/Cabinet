"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { SearchIcon, XIcon } from "lucide-react";
import { SelectField, TextField, useErrorText } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchAgendaPatientsAction } from "@/features/agenda/actions";
import { ACQUISITION_CHANNELS } from "@/lib/acquisition";

type Referrer = { id: string; label: string };

/**
 * "Comment nous avez-vous connu ?" + detail, and the referring patient when the answer is
 * "recommended by a patient". The hidden referrer input is always sent ("" clears it).
 */
export function AcquisitionFields({ values, errors }: { values: Record<string, string | undefined>; errors: Record<string, string> }) {
  const t = useTranslations("acquisition");
  const tp = useTranslations("patients");
  const errorText = useErrorText();
  const [channel, setChannel] = useState(values.acquisitionChannel ?? "");
  const [referrer, setReferrer] = useState<Referrer | null>(
    values.referredByPatientId ? { id: values.referredByPatientId, label: values.referredByPatientLabel || values.referredByPatientId } : null,
  );
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; patientNumber: string; firstName: string; lastName: string }[]>([]);
  const [, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const timer = window.setTimeout(() => start(async () => setRows(await searchAgendaPatientsAction(q))), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const byPatient = channel === "patient_referral";
  return (
    <>
      <SelectField
        label={t("question")}
        name="acquisitionChannel"
        optionalLabel
        placeholder={t("unknown")}
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        options={ACQUISITION_CHANNELS.map((c) => ({ value: c, label: t(`channels.${c}`) }))}
        error={errors.acquisitionChannel}
      />
      <TextField label={tp("fields.referralSource")} name="referralSource" autoComplete="off" optionalLabel defaultValue={values.referralSource}
        placeholder={t("detailPlaceholder")} dir="auto" />
      <input type="hidden" name="referredByPatientId" value={byPatient ? referrer?.id ?? "" : ""} />
      <input type="hidden" name="referredByPatientLabel" value={byPatient ? referrer?.label ?? "" : ""} />
      {byPatient ? (
        <div className="grid gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium">{t("referrer")}</span>
          {referrer ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <bdi>{referrer.label}</bdi>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setReferrer(null)} aria-label={t("clearReferrer")} title={t("clearReferrer")}>
                <XIcon aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="grid gap-1">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchReferrer")} aria-label={t("searchReferrer")} className="ps-8" />
              </div>
              {q.trim().length >= 2 && rows.length ? (
                <ul className="max-h-48 divide-y overflow-y-auto rounded-lg border">
                  {rows.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-accent"
                        onClick={() => { setReferrer({ id: p.id, label: `${p.lastName.toUpperCase()} ${p.firstName} (${p.patientNumber})` }); setQ(""); setRows([]); }}>
                        <bdi>{p.lastName.toUpperCase()} {p.firstName}</bdi>
                        <span className="text-xs text-muted-foreground">{p.patientNumber}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("referrerHint")}</p>
            </div>
          )}
          {errors.referredByPatientId ? <p role="alert" className="text-sm text-destructive">{errorText(errors.referredByPatientId)}</p> : null}
        </div>
      ) : null}
      <TextField label={tp("fields.referredBy")} name="referredBy" autoComplete="off" optionalLabel defaultValue={values.referredBy} dir="auto" />
    </>
  );
}
