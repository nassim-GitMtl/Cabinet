import type { Locale } from "@/i18n/config";

export const DOCUMENT_LANGUAGES = ["fr", "ar", "bilingual"] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

/** Financial prints support French, Arabic, or a French/Arabic bilingual copy. */
export function resolveDocumentLanguage(raw: unknown, patientLocale: unknown): DocumentLanguage {
  if (typeof raw === "string" && DOCUMENT_LANGUAGES.includes(raw as DocumentLanguage)) return raw as DocumentLanguage;
  return patientLocale === "ar" ? "ar" : "fr";
}

export function documentLocale(language: DocumentLanguage): Locale {
  return language === "ar" ? "ar" : "fr";
}

export function documentDirection(language: DocumentLanguage): "ltr" | "rtl" {
  return language === "ar" ? "rtl" : "ltr";
}
