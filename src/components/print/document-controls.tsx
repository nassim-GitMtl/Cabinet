"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { DocumentLanguage } from "@/features/printing/document-language";
import { PrintButton } from "./print-button";

export function DocumentControls({ language, hidden = {} }: { language: DocumentLanguage; hidden?: Record<string, string> }) {
  const t = useTranslations("printDocuments");
  return (
    <div className="no-print mb-4 flex flex-wrap items-end justify-end gap-2 text-sm" dir="ltr">
      <form method="get" className="flex flex-wrap items-end gap-2">
        {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="grid gap-1">
          <span>{t("language")}</span>
          <select name="language" defaultValue={language} className="h-9 rounded-md border bg-white px-2 text-black">
            <option value="fr">{t("fr")}</option>
            <option value="ar">{t("ar")}</option>
            <option value="bilingual">{t("bilingual")}</option>
          </select>
        </label>
        <Button type="submit" variant="outline">{t("apply")}</Button>
      </form>
      <PrintButton />
    </div>
  );
}
