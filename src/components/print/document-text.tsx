import type { ReactNode } from "react";
import type { DocumentLanguage } from "@/features/printing/document-language";
import { cn } from "@/lib/utils";

export function DocumentText({ language, fr, ar, className }: { language: DocumentLanguage; fr: ReactNode; ar: ReactNode; className?: string }) {
  if (language === "fr") return <span lang="fr" dir="ltr" className={className}>{fr}</span>;
  if (language === "ar") return <span lang="ar" dir="rtl" className={className}>{ar}</span>;
  return (
    <span className={cn("document-bilingual inline-grid gap-0.5", className)}>
      <span lang="fr" dir="ltr">{fr}</span>
      <span lang="ar" dir="rtl">{ar}</span>
    </span>
  );
}
