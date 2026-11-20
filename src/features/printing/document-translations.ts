import { createTranslator } from "next-intl";
import frMessages from "../../../messages/fr.json";
import arMessages from "../../../messages/ar.json";

const french = createTranslator({ locale: "fr", messages: frMessages });
const arabic = createTranslator({ locale: "ar", messages: arMessages });

/** Explicit translators avoid inheriting the signed-in staff member's UI locale on a patient-facing print. */
export function documentTranslation(locale: "fr" | "ar", key: string, values?: Record<string, string | number>): string {
  const translate = locale === "ar" ? arabic : french;
  return translate(key as never, values as never);
}
