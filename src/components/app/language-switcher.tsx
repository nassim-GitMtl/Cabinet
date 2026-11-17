"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LanguagesIcon } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { setLocaleAction } from "@/i18n/actions";
import { LOCALES } from "@/i18n/config";

const LABELS: Record<(typeof LOCALES)[number], string> = { fr: "Français", en: "English", ar: "العربية" };
const SHORT: Record<(typeof LOCALES)[number], string> = { fr: "FR", en: "EN", ar: "ع" };

export function LanguageSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className={className}>
      <span className="sr-only">{t("language")}</span>
      <span className="flex items-center gap-2">
        {compact ? null : <LanguagesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <NativeSelect
          value={locale}
          disabled={pending}
          aria-label={t("language")}
          onChange={(e) => {
            const next = e.target.value;
            startTransition(async () => {
              await setLocaleAction(next);
              router.refresh();
            });
          }}
        >
          {LOCALES.map((l) => (
            <NativeSelectOption key={l} value={l} lang={l}>
              {compact ? SHORT[l] : LABELS[l]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </span>
    </label>
  );
}
