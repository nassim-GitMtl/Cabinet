"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, MessageCircleIcon, MessageSquareTextIcon, PhoneIcon } from "lucide-react";
import { useErrorText } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { confirmAppointmentAction, logContactAction } from "../actions";
import { smsUrl, telUrl, whatsappUrl, type ContactChannel, type ContactOutcome, type FollowUpReason } from "../messages";

export type FollowUpItem = {
  key: string;
  reason: FollowUpReason;
  patientId: string;
  patientNumber: string;
  name: string;
  phone: string | null;
  phoneDisplay: string | null;
  contactAllowed: boolean;
  message: string;
  appointmentId: string | null;
  planId: string | null;
  /** After-visit messages refer to the day of the visit. */
  visitDate: string | null;
  details: string[];
  lastContact: string | null;
  confirmation: { status: string; label: string; canConfirm: boolean } | null;
};

const LOGGED_OUTCOMES: ContactOutcome[] = ["reached", "no_answer", "booked", "declined"];

export function FollowUpCard({ item }: { item: FollowUpItem }) {
  const t = useTranslations("followUps");
  const errorText = useErrorText();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Outcomes are logged on the channel last used from this card (a call by default).
  const [channel, setChannel] = useState<ContactChannel>("phone");
  const [outcome, setOutcome] = useState<ContactOutcome>("reached");

  const log = (usedChannel: ContactChannel, result: ContactOutcome) =>
    startTransition(async () => {
      setError(undefined);
      const res = await logContactAction({
        patientId: item.patientId, reason: item.reason, channel: usedChannel, outcome: result,
        appointmentId: item.appointmentId, treatmentPlanId: item.planId, visitDate: item.visitDate,
      });
      if (res.error) setError(res.error);
    });

  const confirm = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await confirmAppointmentAction(item.appointmentId!);
      if (res.error) setError(res.error);
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("errors.generic");
    }
  };

  const canMessage = Boolean(item.phone) && item.contactAllowed;
  const linkClass = (variant: "default" | "outline") => cn(buttonVariants({ variant, size: "sm" }), pending && "pointer-events-none opacity-60");

  return (
    <article className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/patients/${item.patientId}`} className="font-semibold text-primary underline-offset-4 hover:underline">
            <bdi>{item.name}</bdi>
          </Link>
          <p className="text-xs text-muted-foreground">
            <bdi>{item.patientNumber}</bdi>
            {item.phoneDisplay ? <> · <span dir="ltr" className="tabular-nums">{item.phoneDisplay}</span></> : null}
          </p>
        </div>
        {item.confirmation ? (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium",
            item.confirmation.status === "confirmed" ? "bg-success/15 text-success" : item.confirmation.status === "pending" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-destructive/10 text-destructive")}>
            {item.confirmation.label}
          </span>
        ) : null}
      </div>

      {item.details.length ? <p className="text-sm text-muted-foreground">{item.details.map((d, i) => <span key={i}>{i ? " · " : ""}<bdi>{d}</bdi></span>)}</p> : null}

      {canMessage ? (
        <div className="rounded-xl bg-muted/60 p-3">
          <p className={cn("text-sm", !expanded && "line-clamp-3")} dir="auto">{item.message}</p>
          {item.message.length > 180 ? (
            <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0" onClick={() => setExpanded((value) => !value)}>
              {expanded ? t("showLess") : t("showFull")}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm font-medium text-muted-foreground">{item.phone ? t("optedOut") : t("noPhone")}</p>
      )}

      {error ? <p role="alert" className="text-sm font-medium text-destructive">{errorText(error)}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {canMessage ? (
          <>
            <a href={whatsappUrl(item.phone!, item.message)} target="_blank" rel="noreferrer" className={cn(linkClass("default"), "bg-[#1f8f4e] text-white hover:bg-[#1a7a42]")}
              onClick={() => { setChannel("whatsapp"); log("whatsapp", "message_prepared"); }}>
              <MessageCircleIcon aria-hidden />{t("whatsapp")}
            </a>
            <a href={smsUrl(item.phone!, item.message)} className={linkClass("outline")} onClick={() => { setChannel("sms"); log("sms", "message_prepared"); }}>
              <MessageSquareTextIcon aria-hidden />{t("sms")}
            </a>
            <Button type="button" variant="ghost" size="sm" onClick={copy} disabled={pending}>
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}{copied ? t("copied") : t("copy")}
            </Button>
          </>
        ) : null}
        {item.phone ? (
          <a href={telUrl(item.phone)} className={linkClass("outline")} onClick={() => setChannel("phone")}>
            <PhoneIcon aria-hidden />{t("call")}
          </a>
        ) : null}
        {item.confirmation?.canConfirm && item.confirmation.status !== "confirmed" ? (
          <Button type="button" size="sm" variant="outline" onClick={confirm} disabled={pending}>
            <CheckIcon aria-hidden />{t("confirm")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("outcomeLabel")}
          <NativeSelect size="sm" value={outcome} onChange={(e) => setOutcome(e.target.value as ContactOutcome)} disabled={pending}>
            {LOGGED_OUTCOMES.map((o) => <NativeSelectOption key={o} value={o}>{t(`outcomes.${o}`)}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <Button type="button" size="sm" variant="secondary" onClick={() => log(channel, outcome)} disabled={pending}>{t("saveOutcome")}</Button>
        {item.lastContact ? <p className="basis-full text-xs text-muted-foreground"><bdi>{item.lastContact}</bdi></p> : null}
      </div>
    </article>
  );
}
