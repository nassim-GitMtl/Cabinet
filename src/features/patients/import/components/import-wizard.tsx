"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2Icon, DownloadIcon, FileSpreadsheetIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { FormError } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDateOnly } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { IMPORT_FIELDS, type ImportField, type ImportIssue, type ImportMapping } from "../mapping";

type Status = "ready" | "duplicateClinic" | "duplicateFile" | "invalid";
type Analysis = {
  headers: string[];
  mapping: ImportMapping;
  sample: string[][];
  counts: { total: number; ready: number; duplicateClinic: number; duplicateFile: number; invalid: number };
  rows: { line: number; status: Status; name: string; phone: string | null; birthDate: string | null; issues: ImportIssue[] }[];
};
type Result = { imported: number; skippedDuplicates: number; skippedInvalid: number };

const STATUS_CLASS: Record<Status, string> = {
  ready: "bg-success/15 text-success",
  duplicateClinic: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  duplicateFile: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  invalid: "bg-destructive/10 text-destructive",
};

export function ImportWizard() {
  const t = useTranslations("patientImport");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function send(selected: File, mode: "preview" | "import", map?: ImportMapping) {
    setPending(true);
    setError(undefined);
    try {
      const form = new FormData();
      form.set("file", selected);
      form.set("mode", mode);
      if (map) form.set("mapping", JSON.stringify(map));
      if (includeDuplicates) form.set("includeDuplicates", "1");
      const response = await fetch("/api/patients/import", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as Analysis & Result & { error?: string };
      if (!response.ok) { setError(body.error ?? "errors.generic"); return; }
      if (mode === "import") setResult(body);
      else { setAnalysis(body); setMapping(body.mapping); }
    } catch {
      setError("errors.generic");
    } finally {
      setPending(false);
    }
  }

  const changeColumn = (field: ImportField, value: string) => {
    const next = { ...mapping };
    if (value === "") delete next[field];
    else next[field] = Number(value);
    setMapping(next);
    if (file) void send(file, "preview", next);
  };

  if (result) {
    return (
      <section className="grid gap-4 rounded-2xl border bg-card p-6 text-center shadow-sm">
        <CheckCircle2Icon className="mx-auto size-10 text-success" aria-hidden />
        <h2 className="text-xl font-semibold">{t("done", { count: result.imported })}</h2>
        <p className="text-sm text-muted-foreground">{t("doneHint", { duplicates: result.skippedDuplicates, invalid: result.skippedInvalid })}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink href="/patients">{t("seePatients")}</ButtonLink>
          <Button variant="outline" onClick={() => { setResult(null); setAnalysis(null); setFile(null); }}>{t("another")}</Button>
        </div>
      </section>
    );
  }

  const importCount = analysis ? analysis.counts.ready + (includeDuplicates ? analysis.counts.duplicateClinic + analysis.counts.duplicateFile : 0) : 0;
  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><FileSpreadsheetIcon className="size-4 text-primary" aria-hidden />{t("step1")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("step1Hint")}</p>
          </div>
          <a href="/api/patients/import/template" className={buttonVariants({ variant: "outline", size: "sm" })}><DownloadIcon aria-hidden />{t("downloadTemplate")}</a>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="import-file">{t("file")}</Label>
          <Input id="import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setAnalysis(null); if (f) void send(f, "preview"); }} />
          <p className="text-xs text-muted-foreground">{t("fileHint")}</p>
        </div>
        {pending ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" aria-hidden />{t("reading")}</p> : null}
        <FormError error={error} />
      </section>

      {analysis ? (
        <>
          <section className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
            <div>
              <h2 className="font-semibold">{t("step2")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("step2Hint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <label key={field} className="grid gap-1 text-sm">
                  <span className="font-medium">{t(`fields.${field}`)}</span>
                  <NativeSelect value={mapping[field] === undefined ? "" : String(mapping[field])} onChange={(e) => changeColumn(field, e.target.value)} disabled={pending}>
                    <NativeSelectOption value="">{t("notImported")}</NativeSelectOption>
                    {analysis.headers.map((h, i) => (
                      <NativeSelectOption key={i} value={String(i)}>{h}{analysis.sample[0]?.[i] ? ` — ${analysis.sample[0][i]!.slice(0, 24)}` : ""}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              ))}
            </div>
          </section>

          <section className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
            <div>
              <h2 className="font-semibold">{t("step3")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("step3Hint")}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {(["ready", "duplicateClinic", "duplicateFile", "invalid"] as const).map((s) => (
                <span key={s} className={cn("rounded-full px-3 py-1 font-medium", STATUS_CLASS[s])}>{t(`status.${s}`)} · {analysis.counts[s]}</span>
              ))}
              <span className="rounded-full bg-muted px-3 py-1">{t("totalRows", { count: analysis.counts.total })}</span>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-xl border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("line")}</th>
                    <th className="px-3 py-2 text-start">{t("name")}</th>
                    <th className="px-3 py-2 text-start">{t("fields.phone")}</th>
                    <th className="px-3 py-2 text-start">{t("fields.birthDate")}</th>
                    <th className="px-3 py-2 text-start">{t("statusColumn")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {analysis.rows.map((r) => (
                    <tr key={r.line}>
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{r.line}</td>
                      <td className="px-3 py-1.5"><bdi>{r.name || "—"}</bdi></td>
                      <td className="px-3 py-1.5 tabular-nums" dir="ltr">{r.phone ? formatPhone(r.phone) : "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.birthDate ? formatDateOnly(r.birthDate) : "—"}</td>
                      <td className="px-3 py-1.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[r.status])}>{t(`status.${r.status}`)}</span>
                        {r.issues.length ? <span className="block text-xs text-muted-foreground">{r.issues.map((i) => t(`issues.${i.code}`)).join(" · ")}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {analysis.counts.total > analysis.rows.length ? <p className="text-xs text-muted-foreground">{t("previewLimited", { shown: analysis.rows.length, total: analysis.counts.total })}</p> : null}
            {analysis.counts.duplicateClinic + analysis.counts.duplicateFile > 0 ? (
              <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
                <Checkbox checked={includeDuplicates} onCheckedChange={(v) => setIncludeDuplicates(Boolean(v))} />
                <span><span className="block font-medium">{t("includeDuplicates")}</span><span className="block text-xs text-muted-foreground">{t("includeDuplicatesHint")}</span></span>
              </label>
            ) : null}
            <Button className="justify-self-start" disabled={pending || !file || importCount === 0} onClick={() => file && send(file, "import", mapping)}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <UploadIcon aria-hidden />}{t("import", { count: importCount })}
            </Button>
          </section>
        </>
      ) : null}
    </div>
  );
}
