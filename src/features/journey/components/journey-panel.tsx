"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2Icon, CircleDashedIcon, EyeIcon, EyeOffIcon, FlagIcon, ImageIcon, ImagesIcon, Undo2Icon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { DialogButton } from "@/features/billing/components/billing-dialogs";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { formatDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { LocalizedText } from "@/server/db/schema/_shared";
import { shareJourneyAction, withdrawJourneyItemAction } from "../actions";

type Kind = "milestone" | "image" | "comparison";
export type JourneyPanelData = {
  access: { decision: "granted" | "revoked"; decidedAt: string } | null;
  items: Array<{ id: string; kind: Kind; title: string; body: string | null; eventDate: string; sharedBy: string; withdrawnAt: string | null; withdrawReason: string | null; clinicalFileId: string | null; comparisonId: string | null }>;
  progress: Array<{ id: string; title: string; steps: Array<{ id: string; name: LocalizedText; code: string; toothNumber: string | null; doneAt: string | null }> }>;
  images: Array<{ id: string; label: string; clinicalDate: string }>;
  comparisons: Array<{ id: string; beforeFileId: string; afterFileId: string; label: string }>;
  plans: Array<{ id: string; title: string }>;
};

const ICON = { milestone: FlagIcon, image: ImageIcon, comparison: ImagesIcon } as const;

function useForm(fn: (p: ActionState, fd: FormData) => Promise<ActionState>, onOk?: () => void) {
  const router = useRouter();
  return useActionState(async (p: ActionState, fd: FormData) => {
    const r = await fn(p, fd);
    if (r.ok) {
      onOk?.();
      router.refresh();
    }
    return r;
  }, initialActionState);
}

/**
 * Clinic side of the patient's visual journey: what the patient will see in the portal once they switch it on,
 * and the forms to share a step, a photo or a before/after pair in plain language.
 */
export function JourneyPanel({ patientId, data, today, canShareImages }: { patientId: string; data: JourneyPanelData; today: string; canShareImages: boolean }) {
  const t = useTranslations("journey");
  const locale = useLocale();
  const label = (n: LocalizedText) => (n as Record<string, string | undefined>)[locale] || n.fr;
  const visible = data.items.filter((i) => !i.withdrawnAt);
  const withdrawn = data.items.filter((i) => i.withdrawnAt);

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className={cn("flex items-start gap-3 rounded-xl border p-4 text-sm", data.access?.decision === "granted" ? "border-primary/30 bg-primary/5" : "bg-card")}>
          {data.access?.decision === "granted" ? <EyeIcon className="mt-0.5 size-4 text-primary" aria-hidden /> : <EyeOffIcon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />}
          <div>
            <p className="font-medium">
              {data.access?.decision === "granted"
                ? t("access.granted", { date: formatDateOnly(data.access.decidedAt.slice(0, 10)) })
                : data.access?.decision === "revoked"
                  ? t("access.revoked", { date: formatDateOnly(data.access.decidedAt.slice(0, 10)) })
                  : t("access.never")}
            </p>
            <p className="text-xs text-muted-foreground">{t("access.explain")}</p>
          </div>
        </div>

        <ShareForm patientId={patientId} data={data} today={today} canShareImages={canShareImages} />

        {data.progress.length ? (
          <section className="rounded-xl border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">{t("progress.title")}</h3>
            {data.progress.map((plan) => {
              const done = plan.steps.filter((s) => s.doneAt).length;
              return (
                <div key={plan.id} className="mb-3 last:mb-0">
                  <p className="text-sm"><bdi>{plan.title}</bdi> · <span className="text-muted-foreground">{t("progress.count", { done, total: plan.steps.length })}</span></p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {plan.steps.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        {s.doneAt ? <CheckCircle2Icon className="size-3.5 text-primary" aria-hidden /> : <CircleDashedIcon className="size-3.5 text-muted-foreground" aria-hidden />}
                        <bdi>{label(s.name)}{s.toothNumber ? ` · ${s.toothNumber}` : ""}</bdi>
                        {s.doneAt ? <span className="text-muted-foreground">{formatDateOnly(s.doneAt.slice(0, 10))}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p className="mt-2 text-xs text-muted-foreground">{t("progress.automatic")}</p>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-xl border bg-card">
          <h3 className="border-b px-4 py-3 text-sm font-semibold">{t("shared.title")}</h3>
          {visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("shared.empty")}</p>
          ) : (
            <ul className="divide-y">
              {visible.map((item) => {
                const Icon = ICON[item.kind];
                const pair = item.comparisonId ? data.comparisons.find((c) => c.id === item.comparisonId) : null;
                return (
                  <li key={item.id} className="flex gap-3 px-4 py-3">
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium"><bdi>{item.title}</bdi></p>
                      {item.body ? <p className="whitespace-pre-line text-sm text-muted-foreground" dir="auto">{item.body}</p> : null}
                      {item.clinicalFileId ? <Thumb fileId={item.clinicalFileId} alt={item.title} /> : null}
                      {pair ? (
                        <div className="flex gap-2">
                          <Thumb fileId={pair.beforeFileId} alt={t("before")} caption={t("before")} />
                          <Thumb fileId={pair.afterFileId} alt={t("after")} caption={t("after")} />
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {formatDateOnly(item.eventDate)} · {t("shared.by", { name: item.sharedBy })}
                      </p>
                    </div>
                    <WithdrawButton itemId={item.id} patientId={patientId} />
                  </li>
                );
              })}
            </ul>
          )}
          {withdrawn.length ? (
            <details className="border-t px-4 py-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t("shared.withdrawn", { count: withdrawn.length })}</summary>
              <ul className="mt-2 space-y-1">
                {withdrawn.map((i) => (
                  <li key={i.id}><bdi>{i.title}</bdi> · <bdi>{i.withdrawReason}</bdi></li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </div>

    </div>
  );
}

function Thumb({ fileId, alt, caption }: { fileId: string; alt: string; caption?: string }) {
  return (
    <figure className="w-28">
      {/* eslint-disable-next-line @next/next/no-img-element -- private, permission-checked route; not optimizable */}
      <img src={`/api/clinical-files/${fileId}`} alt={alt} loading="lazy" className="aspect-square w-28 rounded-md border object-cover" />
      {caption ? <figcaption className="mt-0.5 text-center text-[11px] text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

function ShareForm({ patientId, data, today, canShareImages }: { patientId: string; data: JourneyPanelData; today: string; canShareImages: boolean }) {
  const t = useTranslations("journey");
  const [kind, setKind] = useState<Kind>("milestone");
  const [state, action] = useForm(shareJourneyAction.bind(null, patientId));
  const [fileId, setFileId] = useState("");
  const [pairId, setPairId] = useState("");
  const kinds: Kind[] = canShareImages ? ["milestone", "image", "comparison"] : ["milestone"];
  const fe = state.fieldErrors ?? {};
  const pair = data.comparisons.find((c) => c.id === pairId);
  return (
    <form key={state.ok ? "sent" : "draft"} action={action} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
      <h3 className="text-sm font-semibold">{t("share.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("share.hint")}</p>
      <FormError error={state.error} />
      <div className="inline-flex rounded-lg border p-0.5 text-sm" role="radiogroup" aria-label={t("share.kind")}>
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn("rounded-md px-3 py-1.5", kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            {t(`kinds.${k}`)}
          </button>
        ))}
      </div>
      <input type="hidden" name="kind" value={kind} />
      {kind === "image" ? (
        data.images.length ? (
          <>
            <SelectField label={t("share.photo")} name="clinicalFileId" value={fileId} onChange={(e) => setFileId(e.target.value)} placeholder={t("share.choose")} options={data.images.map((i) => ({ value: i.id, label: `${formatDateOnly(i.clinicalDate)} · ${i.label}` }))} error={fe.clinicalFileId} />
            {fileId ? <Thumb fileId={fileId} alt="" /> : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("share.noPhotos")}</p>
        )
      ) : null}
      {kind === "comparison" ? (
        data.comparisons.length ? (
          <>
            <SelectField label={t("share.pair")} name="comparisonId" value={pairId} onChange={(e) => setPairId(e.target.value)} placeholder={t("share.choose")} options={data.comparisons.map((c) => ({ value: c.id, label: c.label }))} error={fe.comparisonId} />
            {pair ? (
              <div className="flex gap-2">
                <Thumb fileId={pair.beforeFileId} alt={t("before")} caption={t("before")} />
                <Thumb fileId={pair.afterFileId} alt={t("after")} caption={t("after")} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("share.noPairs")}</p>
        )
      ) : null}
      {kind === "milestone" && data.plans.length ? (
        <SelectField label={t("share.plan")} name="treatmentPlanId" optionalLabel placeholder={t("share.noPlan")} options={data.plans.map((p) => ({ value: p.id, label: p.title }))} defaultValue={state.values?.treatmentPlanId} />
      ) : null}
      <TextField label={t("share.titleField")} name="title" required maxLength={160} hint={t(`share.titleHint.${kind}`)} defaultValue={state.values?.title} error={fe.title} />
      <TextAreaField label={t("share.body")} name="body" optionalLabel rows={4} maxLength={2000} hint={t("share.bodyHint")} defaultValue={state.values?.body} />
      <TextField label={t("share.date")} name="eventDate" type="date" required defaultValue={state.values?.eventDate ?? today} max={kind === "milestone" ? undefined : today} error={fe.eventDate} />
      <SubmitButton className="w-full">{t("share.submit")}</SubmitButton>
      {state.ok ? <p className="text-xs text-primary" role="status">{t("share.done")}</p> : null}
    </form>
  );
}

function WithdrawButton({ itemId, patientId }: { itemId: string; patientId: string }) {
  const t = useTranslations("journey");
  return (
    <DialogButton label={t("withdraw.button")} title={t("withdraw.title")} description={t("withdraw.hint")} variant="ghost" icon={<Undo2Icon aria-hidden />}>
      {(close) => <WithdrawForm itemId={itemId} patientId={patientId} close={close} />}
    </DialogButton>
  );
}

function WithdrawForm({ itemId, patientId, close }: { itemId: string; patientId: string; close: () => void }) {
  const t = useTranslations("journey");
  const [state, action] = useForm(withdrawJourneyItemAction.bind(null, itemId, patientId), close);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError error={state.error} />
      <TextField label={t("withdraw.reason")} name="reason" required defaultValue={state.values?.reason} error={state.fieldErrors?.reason} />
      <SubmitButton variant="destructive" className="w-full">{t("withdraw.button")}</SubmitButton>
    </form>
  );
}

