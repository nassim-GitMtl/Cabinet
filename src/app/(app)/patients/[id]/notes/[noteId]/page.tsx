import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { ForbiddenState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { AmendForm, NoteEditor } from "@/features/notes/components/note-editor";
import { canSign, getNote } from "@/features/notes/server";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import type { NoteBody } from "@/server/db/schema";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("notes"))("title") };
}

const SECTIONS = ["chiefComplaint", "observations", "assessment", "plan", "performedWork"] as const;

function BodyView({ body, t }: { body: NoteBody; t: (k: string) => string }) {
  return (
    <dl className="space-y-3">
      {SECTIONS.filter((k) => body[k].trim()).map((k) => (
        <div key={k}>
          <dt className="text-xs font-medium text-muted-foreground">{t(`sections.${k}`)}</dt>
          <dd className="whitespace-pre-line" dir="auto">{body[k]}</dd>
        </div>
      ))}
      {body.teeth.length ? (
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t("teeth")}</dt>
          <dd className="tabular" dir="ltr">{body.teeth.join(", ")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export default async function NotePage({ params }: PageProps<"/patients/[id]/notes/[noteId]">) {
  const { id, noteId } = await params;
  const ctx = await requireClinicContext();
  const t = await getTranslations("notes");
  if (!can(ctx, "clinical.read")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const data = await getNote(ctx, noteId);
  if (!data || data.note.patientId !== id || data.note.status === "discarded") notFound();
  const { note } = data;
  const tz = ctx.organization.timezone;
  const tt = (k: string) => t(k as never);
  const editable = (note.status === "draft" || note.status === "in_review") && can(ctx, "clinical.write");
  const latest = data.versions.at(-1)?.v.body;

  return (
    <>
      <Link href={`/patients/${id}?tab=clinical`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        <bdi>{`${data.patientLast.toUpperCase()} ${data.patientFirst}`}</bdi> · {data.patientNumber}
      </Link>
      <header className="mb-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">{t(`kinds.${note.kind}`)} · {formatDateOnly(note.serviceDate)}</h1>
            <p className="text-sm text-muted-foreground">
              <bdi>{[data.providerTitle, data.providerName].filter(Boolean).join(" ")}</bdi> · {t("author", { name: data.authorName })}
              {note.templateName ? ` · ${t("fromTemplate", { name: note.templateName })}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={note.status === "signed" ? "default" : "outline"}>{t(`status.${note.status}`)}</Badge>
            {note.currentVersion > 1 ? <Badge variant="secondary">{t("amendedBadge", { count: note.currentVersion - 1 })}</Badge> : null}
            {note.status === "signed" ? (
              data.chainValid ? (
                <Badge variant="outline" className="border-success/40 text-success"><ShieldCheckIcon aria-hidden />{t("integrityOk")}</Badge>
              ) : (
                <Badge variant="destructive"><ShieldAlertIcon aria-hidden />{t("integrityBroken")}</Badge>
              )
            ) : null}
          </div>
        </div>
      </header>

      {editable ? (
        <NoteEditor
          noteId={note.id}
          patientId={id}
          initialBody={note.draftBody!}
          initialVersion={note.version}
          status={note.status as "draft" | "in_review"}
          canSign={canSign(ctx)}
        />
      ) : (
        <div className="space-y-4">
          {data.versions.map(({ v, signerName }) => (
            <article key={v.id} className={v.kind === "original" ? "rounded-xl border bg-card p-4" : "rounded-xl border border-primary/30 bg-accent/30 p-4"}>
              <p className="mb-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{v.kind === "original" ? t("original") : t("amendmentN", { n: v.versionNo - 1 })}</span>
                {" · "}
                {t("signedBy", { name: signerName, date: formatDateTime(v.signedAt, tz) })}
                {" · "}
                <span className="font-mono" title={v.contentHash}>#{v.contentHash.slice(0, 10)}</span>
              </p>
              {v.amendmentReason ? <p className="mb-3 text-sm"><span className="font-medium">{t("amendReason")} :</span> {v.amendmentReason}</p> : null}
              <BodyView body={v.body} t={tt} />
            </article>
          ))}
          {note.status === "signed" && canSign(ctx) && latest ? <AmendForm noteId={note.id} patientId={id} current={latest} /> : null}
          {note.status === "in_review" && !can(ctx, "clinical.write") ? <p className="text-sm text-muted-foreground">{t("awaitingSignature")}</p> : null}
        </div>
      )}
    </>
  );
}
