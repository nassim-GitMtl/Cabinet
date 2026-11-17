export const LOCALES = ["fr", "en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);
export const directionOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");

/** BCP 47 tags used for Intl formatting (numbers, dates) per UI locale. */
export const INTL_LOCALE: Record<Locale, string> = { fr: "fr-DZ", en: "en-GB", ar: "ar-DZ" };
