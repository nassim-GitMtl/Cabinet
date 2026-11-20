"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CameraIcon, ExternalLinkIcon, FileTextIcon, ImageIcon, Loader2Icon, ScanLineIcon, UploadIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { FormError, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDateOnly } from "@/lib/dates";
import { CLINICAL_FILE_CATEGORIES } from "../schemas";

type FileRow = {
  file: {
    id: string; kind: "image" | "document"; category: (typeof CLINICAL_FILE_CATEGORIES)[number]; title: string | null;
    clinicalDate: string; toothNumbers: string[]; mimeType: string; originalFilename: string; byteSize: number; createdAt: Date;
  };
  uploaderName: string;
};
type Comparison = { id: string; beforeFileId: string; afterFileId: string };

export function ClinicalFilesPanel({ patientId, rows, comparisons, canWrite, today }: {
  patientId: string; rows: FileRow[]; comparisons: Comparison[]; canWrite: boolean; today: string;
}) {
  const t = useTranslations("clinicalFiles");
  const common = useTranslations("common");
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const byId = useMemo(() => new Map(rows.map((row) => [row.file.id, row])), [rows]);
  const pairedIds = useMemo(() => new Set(comparisons.flatMap((pair) => [pair.beforeFileId, pair.afterFileId])), [comparisons]);
  const comparisonRows = comparisons.flatMap((pair) => {
    const before = byId.get(pair.beforeFileId); const after = byId.get(pair.afterFileId);
    return before && after ? [{ id: pair.id, before, after }] : [];
  });
  const unpaired = rows.filter((row) => !pairedIds.has(row.file.id));
  const beforeCandidates = rows.filter((row) => row.file.kind === "image" && !pairedIds.has(row.file.id));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // currentTarget is null once the handler has awaited; keep the element.
    const formElement = event.currentTarget;
    if (!selected) { setError("clinicalFiles.errors.emptyFile"); return; }
    setPending(true); setError(undefined);
    const form = new FormData(formElement); form.set("file", selected);
    try {
      const response = await fetch(`/api/patients/${patientId}/clinical-files`, { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error ?? "errors.generic"); return; }
      formElement.reset(); setSelected(null); router.refresh();
    } catch { setError("errors.generic"); }
    finally { setPending(false); }
  }

  return <div className="space-y-6">
    {canWrite ? <form onSubmit={submit} className="relative space-y-5 overflow-hidden rounded-2xl border border-border/80 bg-card/90 p-4 shadow-[0_14px_30px_-28px_rgba(48,39,25,.42)] sm:p-5">
      <div className="relative flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><UploadIcon className="size-5" aria-hidden /></div><div><h2 className="font-semibold tracking-[-0.01em]">{t("uploadTitle")}</h2><p className="text-sm text-muted-foreground">{t("uploadHint")}</p></div></div>
      <FormError error={error} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5 md:col-span-2"><Label htmlFor="clinical-file">{t("file")}</Label><Input id="clinical-file" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,application/dicom,.dcm" onChange={(event) => setSelected(event.target.files?.[0] ?? null)} /><Label htmlFor="clinical-file" className="group flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-primary/25 bg-accent/20 p-4 transition hover:border-primary/55 hover:bg-accent/40"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground transition group-hover:text-primary"><UploadIcon className="size-5" aria-hidden /></span><span className="min-w-0"><span className="block truncate text-sm font-medium"><bdi>{selected?.name ?? t("file")}</bdi></span><span className="block text-xs font-normal text-muted-foreground">{t("fileHint")}</span></span></Label></div>
        <input ref={cameraRef} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setSelected(event.target.files?.[0] ?? null)} />
        <div className="md:col-span-2"><Button type="button" variant="outline" onClick={() => cameraRef.current?.click()}><CameraIcon />{t("takePhoto")}</Button></div>
        <div className="grid gap-1.5"><Label htmlFor="clinical-category">{t("category")}</Label><NativeSelect id="clinical-category" name="category" required defaultValue="intraoral_photo">{CLINICAL_FILE_CATEGORIES.map((category) => <NativeSelectOption key={category} value={category}>{t(`categories.${category}`)}</NativeSelectOption>)}</NativeSelect></div>
        <TextField name="clinicalDate" type="date" label={t("clinicalDate")} required defaultValue={today} max={today} />
        <TextField name="title" label={t("titleField")} optionalLabel maxLength={200} dir="auto" />
        <TextField name="toothNumbers" label={t("teeth")} optionalLabel placeholder="11, 12, 21" dir="ltr" hint={t("teethHint")} />
        <div className="grid gap-1.5 md:col-span-2"><Label htmlFor="compare-file">{t("compareTo")}</Label><NativeSelect id="compare-file" name="compareToFileId" defaultValue=""><NativeSelectOption value="">{t("noComparison")}</NativeSelectOption>{beforeCandidates.map((row) => <NativeSelectOption key={row.file.id} value={row.file.id}>{formatDateOnly(row.file.clinicalDate)} · {row.file.title || row.file.originalFilename}</NativeSelectOption>)}</NativeSelect><p className="text-xs text-muted-foreground">{t("compareHint")}</p></div>
      </div>
      <Button type="submit" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}{pending ? common("saving") : t("upload")}</Button>
    </form> : null}

    {comparisonRows.length ? <section><h2 className="mb-3 font-semibold">{t("comparisons")}</h2><div className="grid gap-4 xl:grid-cols-2">{comparisonRows.map((pair) => <article key={pair.id} className="grid overflow-hidden rounded-2xl border bg-card sm:grid-cols-2"><FileCard row={pair.before} label={t("before")} /><FileCard row={pair.after} label={t("after")} /></article>)}</div></section> : null}
    <section><div className="mb-3"><h2 className="font-semibold">{t("library")}</h2><p className="text-sm text-muted-foreground">{t("libraryHint")}</p></div>{unpaired.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{unpaired.map((row) => <FileCard key={row.file.id} row={row} />)}</div> : <div className="rounded-2xl border border-dashed bg-card p-8 text-center"><ImageIcon className="mx-auto mb-2 size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">{t("empty")}</p></div>}</section>
  </div>;
}

function FileCard({ row, label }: { row: FileRow; label?: string }) {
  const t = useTranslations("clinicalFiles"); const file = row.file; const url = `/api/clinical-files/${file.id}`;
  const size = file.byteSize >= 1024 * 1024 ? `${(file.byteSize / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(file.byteSize / 1024)} KB`;
  return <div className="min-w-0 border-border p-3 sm:border-e last:border-e-0">
    {label ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{label}</p> : null}
    {file.kind === "image" ? <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border bg-muted">
      <Image src={url} alt={file.title || t(`categories.${file.category}`)} width={800} height={600} unoptimized className="aspect-[4/3] w-full object-cover" />
    </a> : <div className="flex aspect-[4/3] items-center justify-center rounded-xl border bg-muted">{file.mimeType === "application/dicom" ? <ScanLineIcon className="size-12 text-muted-foreground" /> : <FileTextIcon className="size-12 text-muted-foreground" />}</div>}
    <div className="mt-3"><h3 className="truncate font-medium" dir="auto">{file.title || t(`categories.${file.category}`)}</h3><p className="text-xs text-muted-foreground">{formatDateOnly(file.clinicalDate)} · {size}{file.toothNumbers.length ? ` · ${t("teethShort")} ${file.toothNumbers.join(", ")}` : ""}</p><p className="truncate text-xs text-muted-foreground"><bdi>{file.originalFilename}</bdi> · {t("uploadedBy", { name: row.uploaderName })}</p><ButtonLink href={url} target="_blank" variant="outline" size="sm" className="mt-2"><ExternalLinkIcon />{file.kind === "image" || file.mimeType === "application/pdf" ? t("open") : t("download")}</ButtonLink></div>
  </div>;
}
