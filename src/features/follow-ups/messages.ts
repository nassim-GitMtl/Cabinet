// Pure helpers for follow-up messages: template filling and one-tap WhatsApp/SMS/phone links.
// Nothing is sent by the server: links open the staff member's own WhatsApp/SMS app with the text ready.

export const FOLLOW_UP_REASONS = ["appointment_reminder", "recall", "treatment_followup", "estimate_followup", "no_show", "after_visit", "referral_thanks", "installment_due"] as const;
export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number];
export const CONTACT_CHANNELS = ["whatsapp", "sms", "phone", "in_person"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const CONTACT_OUTCOMES = ["message_prepared", "reached", "no_answer", "booked", "declined"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export const MESSAGE_LOCALES = ["fr", "en", "ar"] as const;
export type MessageLocale = (typeof MESSAGE_LOCALES)[number];

/** Placeholders staff can use in templates (shown in settings). */
export const TEMPLATE_PLACEHOLDERS = ["firstName", "lastName", "clinic", "date", "time", "provider", "clinicPhone", "months", "bookingLink", "careInstructions", "reviewLink", "amount"] as const;
export const MAX_TEMPLATE_LENGTH = 700;

export function asMessageLocale(value: string | null | undefined): MessageLocale {
  return value === "ar" || value === "en" ? value : "fr";
}

const FSI = "\u2068"; // first-strong isolate
const PDI = "\u2069"; // pop directional isolate
/** Links must stay bare so WhatsApp/SMS apps still detect them; care text is already in the message language. */
const NOT_ISOLATED = new Set(["bookingLink", "reviewLink", "careInstructions"]);

/**
 * With `isolate` (Arabic messages), each inserted value is wrapped in invisible Unicode direction isolates so
 * Latin names, dates, phone numbers and amounts keep their own order inside right-to-left text
 * ("0661 00 00 99" would otherwise show as "99 00 00 0661").
 *
 * Replaces `{name}` placeholders. Unknown placeholders are kept as typed so a typo is visible;
 * empty values are removed together with the doubled spaces/punctuation spacing they leave.
 */
export function fillTemplate(
  template: string,
  values: Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string | null | undefined>>,
  opts: { isolate?: boolean } = {},
): string {
  return template
    .replace(/\{(\w+)\}/g, (match, key: string) => {
      if (!(key in values)) return match;
      const value = (values as Record<string, string | null | undefined>)[key] ?? "";
      return opts.isolate && value && !NOT_ISOLATED.has(key) ? `${FSI}${value}${PDI}` : value;
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([.,،])/g, "$1")
    .trim();
}

/** wa.me needs the international number without "+" or spaces. */
export function whatsappUrl(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/** `?&body=` is understood by both Android and iOS messaging apps. */
export function smsUrl(e164: string, text: string): string {
  return `sms:${e164.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(text)}`;
}

export function telUrl(e164: string): string {
  return `tel:${e164.replace(/[^\d+]/g, "")}`;
}

const INTL_LOCALE: Record<MessageLocale, string> = { fr: "fr-FR", en: "en-GB", ar: "ar-DZ" };

/** "mardi 24/11/2026" in the patient's language; numerals stay Latin (as used in Algeria). */
export function messageDate(date: string, locale: MessageLocale): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Intl.DateTimeFormat(`${INTL_LOCALE[locale]}-u-nu-latn`, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}
