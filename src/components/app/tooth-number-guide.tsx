"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function ToothIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path
        d="M10.2 4.7c-3.1.7-5.1 3.5-4.7 6.8.3 2.5 1.5 4.3 2.2 6.8.9 3.3.7 8.7 3.4 8.9 2 .2 2.5-4.1 3-6.2.3-1.8.8-3.1 1.9-3.1s1.6 1.3 1.9 3.1c.5 2.1 1 6.4 3 6.2 2.7-.2 2.5-5.6 3.4-8.9.7-2.5 1.9-4.3 2.2-6.8.4-3.3-1.6-6.1-4.7-6.8-2.3-.5-3.7.8-5.8.8s-3.5-1.3-5.8-.8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M11 9.5c1.5 1 3.1 1.4 5 1.4s3.5-.4 5-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const QUADRANTS = [
  { key: "upperRight", numbers: [18, 17, 16, 15, 14, 13, 12, 11] },
  { key: "upperLeft", numbers: [21, 22, 23, 24, 25, 26, 27, 28] },
  { key: "lowerRight", numbers: [48, 47, 46, 45, 44, 43, 42, 41] },
  { key: "lowerLeft", numbers: [31, 32, 33, 34, 35, 36, 37, 38] },
] as const;

export function ToothNumberGuide({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("toothGuide");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon" : "default"}
        className={cn(!compact && "w-full justify-start gap-2 border-sidebar-border bg-background/70")}
        aria-label={t("open")}
        onClick={() => setOpen(true)}
      >
        <ToothIcon className="size-5" />
        {!compact ? t("open") : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><ToothIcon className="size-6" /></span>
              {t("title")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="rounded-2xl border bg-gradient-to-b from-primary/5 via-card to-card p-3 sm:p-5" dir="ltr">
            <div className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("upperArch")}
            </div>
            <div className="grid grid-cols-2 divide-x overflow-hidden rounded-xl border bg-card shadow-sm">
              {QUADRANTS.slice(0, 2).map((quadrant) => (
                <div key={quadrant.key} className="p-2 sm:p-3">
                  <p className="mb-2 text-center text-[11px] font-medium text-primary">{t(quadrant.key)}</p>
                  <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
                    {quadrant.numbers.map((number) => <ToothNumber key={number} number={number} />)}
                  </div>
                </div>
              ))}
            </div>

            <div className="my-3 flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="grid size-8 place-items-center rounded-full border bg-background text-xs font-bold text-primary">FDI</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="grid grid-cols-2 divide-x overflow-hidden rounded-xl border bg-card shadow-sm">
              {QUADRANTS.slice(2).map((quadrant) => (
                <div key={quadrant.key} className="p-2 sm:p-3">
                  <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
                    {quadrant.numbers.map((number) => <ToothNumber key={number} number={number} />)}
                  </div>
                  <p className="mt-2 text-center text-[11px] font-medium text-primary">{t(quadrant.key)}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("lowerArch")}
            </div>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p className="rounded-lg bg-muted/60 p-3"><strong className="text-foreground">{t("firstDigit")}</strong> {t("firstDigitHint")}</p>
            <p className="rounded-lg bg-muted/60 p-3"><strong className="text-foreground">{t("secondDigit")}</strong> {t("secondDigitHint")}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToothNumber({ number }: { number: number }) {
  return (
    <span className="group grid aspect-square min-h-8 place-items-center rounded-lg border bg-background text-xs font-bold tabular text-foreground shadow-xs transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground sm:min-h-10">
      {number}
    </span>
  );
}
