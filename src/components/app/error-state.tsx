"use client";

import { useTranslations } from "next-intl";
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { Button } from "@/components/ui/button";

/** Shown instead of a page that failed: retry, a way back, and a reference support can trace in the logs. */
export function ErrorState({ digest, reset, homeHref }: { digest?: string; reset: () => void; homeHref: string }) {
  const t = useTranslations("errors");
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
      <TriangleAlertIcon className="mx-auto size-8 text-warning" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold">{t("crashTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("crashBody")}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}><RotateCcwIcon aria-hidden />{t("retry")}</Button>
        <ButtonLink href={homeHref} variant="outline">{t("backToStart")}</ButtonLink>
      </div>
      {digest ? <p className="mt-4 font-mono text-xs text-muted-foreground" dir="ltr">{t("reference", { digest })}</p> : null}
    </div>
  );
}
