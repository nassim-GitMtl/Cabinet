import "server-only";

import ar from "../../../messages/ar.json";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { formatPhone } from "@/lib/phone";
import type { ClinicContext } from "@/server/auth/context";
import { fillTemplate, FOLLOW_UP_REASONS, messageDate, MESSAGE_LOCALES, type FollowUpReason, type MessageLocale } from "./messages";
import type { FollowUpPatient, getMessageContext } from "./server";

const DEFAULTS: Record<MessageLocale, Record<FollowUpReason, string>> = {
  fr: fr.followUps.templates, en: en.followUps.templates, ar: ar.followUps.templates,
};
const REVIEW_SENTENCE: Record<MessageLocale, string> = {
  fr: fr.followUps.reviewSentence, en: en.followUps.reviewSentence, ar: ar.followUps.reviewSentence,
};

export type Templates = Record<FollowUpReason, Record<MessageLocale, string>>;

/** Built-in wording in each language, overridden by the clinic's own templates when set. */
export function resolveTemplates(ctx: ClinicContext): Templates {
  const custom = ctx.organization.settings.followUps?.templates ?? {};
  return Object.fromEntries(FOLLOW_UP_REASONS.map((reason) => [
    reason, Object.fromEntries(MESSAGE_LOCALES.map((locale) => [locale, custom[reason]?.[locale]?.trim() || DEFAULTS[locale][reason]])),
  ])) as Templates;
}

export function defaultTemplates(): Templates {
  return Object.fromEntries(FOLLOW_UP_REASONS.map((reason) => [
    reason, Object.fromEntries(MESSAGE_LOCALES.map((locale) => [locale, DEFAULTS[locale][reason]])),
  ])) as Templates;
}

type MessageContext = Awaited<ReturnType<typeof getMessageContext>>;
export type ComposeContext = MessageContext & {
  bookingUrl: string | null;
  recallMonths: number;
  /** Clinic settings: review page and care instructions per catalog category (after-visit messages). */
  reviewUrl?: string | null;
  aftercare?: Record<string, Partial<Record<MessageLocale, string>>>;
};

/** Care instructions the clinic wrote for the categories of treatments done that day, in the patient's language. */
export function careInstructionsFor(categoryIds: string[], locale: MessageLocale, aftercare: ComposeContext["aftercare"] = {}): string {
  return categoryIds.map((id) => aftercare[id]?.[locale]?.trim()).filter(Boolean).join(" ");
}

/**
 * The text staff will send, in the patient's language. No diagnoses or procedure names; the only clinical text is
 * the clinic's own aftercare advice in after-visit messages, sent to the patient's own number and reviewed before sending.
 */
export function composeMessage(
  templates: Templates,
  reason: FollowUpReason,
  row: FollowUpPatient & { branchId?: string; date?: string; time?: string; provider?: string; categoryIds?: string[] },
  context: ComposeContext,
): string {
  const locale = row.locale;
  const phone = (row.branchId ? context.phones.get(row.branchId) : null) ?? context.defaultPhone;
  const template = templates[reason][locale];
  const text = fillTemplate(template, {
    firstName: locale === "ar" && row.firstNameAr ? row.firstNameAr : row.firstName,
    lastName: row.lastName,
    clinic: context.clinicName,
    date: row.date ? messageDate(row.date, locale) : "",
    time: row.time ?? "",
    provider: row.provider ?? "",
    clinicPhone: phone ? formatPhone(phone) : "",
    months: String(context.recallMonths),
    bookingLink: context.bookingUrl ?? "",
    careInstructions: reason === "after_visit" ? careInstructionsFor(row.categoryIds ?? [], locale, context.aftercare) : "",
    reviewLink: context.reviewUrl ?? "",
  });
  // After a visit, ask for a review when the clinic set a link (unless its own wording already places it).
  if (reason === "after_visit" && context.reviewUrl && !template.includes("{reviewLink}")) {
    return `${text} ${fillTemplate(REVIEW_SENTENCE[locale], { reviewLink: context.reviewUrl })}`;
  }
  return text;
}
