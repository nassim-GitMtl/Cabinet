"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, Link2Icon, UnlinkIcon } from "lucide-react";
import { FormError, SubmitButton, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createPairingCodeAction, pairClinicComputerAction, revokeClinicNodeAction } from "@/features/sync/actions";
import { initialActionState } from "@/lib/action-state";

/** Cloud: create a pairing code and show it once. */
export function PairingCodeForm({ cloudUrl }: { cloudUrl: string }) {
  const t = useTranslations("sync.settings");
  const format = useFormatter();
  const [state, action] = useActionState(createPairingCodeAction, initialActionState);
  const [copied, setCopied] = useState(false);
  const created = state.data as { code: string; expiresAt: string } | undefined;
  return <div className="space-y-4">
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormError error={state.error} />
      <TextField name="label" label={t("label")} defaultValue={t("labelDefault")} maxLength={80} fieldClassName="min-w-56 flex-1" />
      <SubmitButton><Link2Icon aria-hidden />{t("create")}</SubmitButton>
    </form>
    {created ? <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-medium">{t("codeTitle")}</p>
      <p className="mt-2 font-mono text-2xl tracking-widest" dir="ltr">{created.code}</p>
      <p className="mt-3 text-sm text-muted-foreground">{t("codeHint")}</p>
      <p className="mt-1 font-mono text-sm" dir="ltr">{cloudUrl}</p>
      <p className="mt-2 text-xs text-muted-foreground">{t("pending", { time: format.dateTime(new Date(created.expiresAt), { hour: "2-digit", minute: "2-digit" }) })}</p>
      <Button type="button" size="sm" variant="outline" className="mt-3" onClick={async () => { await navigator.clipboard.writeText(created.code); setCopied(true); }}>
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}{created.code}
      </Button>
    </div> : null}
  </div>;
}

/** Cloud: unpair (explicit confirmation; unsent clinic changes are lost). */
export function UnpairForm() {
  const t = useTranslations("sync.settings");
  const [state, action] = useActionState(revokeClinicNodeAction, initialActionState);
  if (state.ok) return <p className="text-sm" role="status">{t("unpaired")}</p>;
  return <form action={action} className="space-y-3">
    <p className="font-medium">{t("unpairTitle")}</p>
    <p className="text-sm text-muted-foreground">{t("unpairHint")}</p>
    <label className="flex items-center gap-2 text-sm"><Checkbox name="confirm" />{t("unpairConfirm")}</label>
    {state.fieldErrors?.confirm ? <p className="text-xs text-destructive">{t("unpairConfirm")}</p> : null}
    <SubmitButton variant="destructive"><UnlinkIcon aria-hidden />{t("unpair")}</SubmitButton>
  </form>;
}

/** Fresh clinic computer: pairing form. */
export function PairComputerForm({ defaultUrl }: { defaultUrl: string }) {
  const t = useTranslations("sync.setup");
  const [state, action] = useActionState(pairClinicComputerAction, initialActionState);
  return <form action={action} className="space-y-4" noValidate>
    <FormError error={state.error} />
    <TextField name="cloudUrl" label={t("cloudUrl")} type="url" dir="ltr" placeholder="https://" required defaultValue={state.values?.cloudUrl ?? defaultUrl} error={state.fieldErrors?.cloudUrl} />
    <TextField name="code" label={t("code")} dir="ltr" autoComplete="off" placeholder="ABCD-EFGH-JKMN-PQRS" required error={state.fieldErrors?.code} />
    <SubmitButton className="w-full" size="lg">{t("submit")}</SubmitButton>
  </form>;
}

/** Reloads the page every few seconds while the first copy runs. */
export function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
