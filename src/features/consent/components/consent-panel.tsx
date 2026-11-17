"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, ExternalLinkIcon, ShieldCheckIcon } from "lucide-react";
import { FormError, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createConsentRequestAction, createPortalInvitationAction } from "@/features/consent/actions";
import { initialActionState } from "@/lib/action-state";
import { formatDateTime } from "@/lib/dates";
import { SHARE_CATEGORIES, type ConsentScope, type ShareCategory } from "@/server/db/schema";

type Overview = {
  networkPatientId: string | null;
  invitations: { email: string; expiresAt: Date; usedAt: Date | null; createdAt: Date }[];
  requests: { id: string; purpose: string; requestedScope: ConsentScope; status: string; expiresAt: Date; createdAt: Date }[];
  grants: { id: string; categories: ShareCategory[]; status: string; grantedAt: Date; revokedAt: Date | null }[];
};

export function ConsentPanel({ patientId, overview, timezone, defaultEmail }: { patientId: string; overview: Overview; timezone: string; defaultEmail: string | null }) {
  const t = useTranslations("consent");
  const [copied, setCopied] = useState(false);
  const [inviteState, inviteAction] = useActionState(createPortalInvitationAction.bind(null, patientId), initialActionState);
  const [requestState, requestAction] = useActionState(createConsentRequestAction.bind(null, patientId), initialActionState);
  const invite = inviteState.data as { activationPath: string; expiresAt: string } | undefined;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheckIcon className="size-4 text-primary" aria-hidden />
        {t("title")}
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">{t("description")}</p>

      <details className="group rounded-lg border p-3" open={!overview.networkPatientId}>
        <summary className="cursor-pointer text-sm font-medium">{t("inviteTitle")}</summary>
        <form action={inviteAction} className="mt-3 space-y-3" noValidate>
          <FormError error={inviteState.error} />
          <TextField label={t("email")} name="email" type="email" inputMode="email" required defaultValue={inviteState.values?.email ?? defaultEmail ?? ""} error={inviteState.fieldErrors?.email} />
          <TextField label={t("evidenceRef")} name="evidenceRef" required hint={t("evidenceHint")} defaultValue={inviteState.values?.evidenceRef} error={inviteState.fieldErrors?.evidenceRef} />
          <SubmitButton className="w-full" variant="outline">{t("createInvite")}</SubmitButton>
        </form>
        {invite ? (
          <div className="mt-3 rounded-md bg-primary/5 p-3 text-xs">
            <p className="font-medium text-primary">{t("activationLink")}</p>
            <code className="mt-1 block break-all" dir="ltr">{invite.activationPath}</code>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(`${location.origin}${invite.activationPath}`); setCopied(true); }}>
                {copied ? <CheckIcon /> : <CopyIcon />}{copied ? t("copied") : t("copyLink")}
              </Button>
              <a href={invite.activationPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLinkIcon className="size-3" />{t("openLink")}</a>
            </div>
          </div>
        ) : null}
      </details>

      {overview.networkPatientId ? (
        <details className="mt-3 rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("requestTitle")}</summary>
          <form action={requestAction} className="mt-3 space-y-3" noValidate>
            <FormError error={requestState.error} />
            <TextAreaField label={t("purpose")} name="purpose" required rows={2} defaultValue={requestState.values?.purpose} error={requestState.fieldErrors?.purpose} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t("categories")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SHARE_CATEGORIES.map((category) => (
                  <label key={category} className="flex items-center gap-2 text-xs">
                    <Checkbox name="categories" value={category} defaultChecked={category === "summary" || category === "alerts"} />
                    {t(`category.${category}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-2">
              <TextField label={t("dateFrom")} name="dateFrom" type="date" optionalLabel error={requestState.fieldErrors?.dateFrom} />
              <TextField label={t("dateTo")} name="dateTo" type="date" optionalLabel error={requestState.fieldErrors?.dateTo} />
            </div>
            <label className="flex items-center gap-2 text-xs"><Checkbox name="includeFutureUpdates" />{t("futureUpdates")}</label>
            <input type="hidden" name="expiresInDays" value="30" />
            <SubmitButton className="w-full">{t("sendRequest")}</SubmitButton>
            {requestState.ok ? <p className="text-xs font-medium text-success">{t("requestSent")}</p> : null}
          </form>
        </details>
      ) : null}

      <div className="mt-4 space-y-2">
        {overview.requests.slice(0, 4).map((request) => (
          <div key={request.id} className="rounded-md bg-muted/60 p-2 text-xs">
            <div className="flex items-start justify-between gap-2"><bdi className="line-clamp-2">{request.purpose}</bdi><Badge variant="secondary">{t(`status.${request.status}`)}</Badge></div>
            <p className="mt-1 text-muted-foreground">{formatDateTime(request.createdAt, timezone)}</p>
          </div>
        ))}
        {overview.requests.length === 0 ? <p className="text-xs text-muted-foreground">{t("noRequests")}</p> : null}
      </div>
    </section>
  );
}
