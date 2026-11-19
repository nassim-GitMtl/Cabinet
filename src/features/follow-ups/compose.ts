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

/** The text staff will send, in the patient's language. Contains no clinical details. */
export function composeMessage(
  templates: Templates,
  reason: FollowUpReason,
  row: FollowUpPatient & { branchId?: string; date?: string; time?: string; provider?: string },
  context: MessageContext & { bookingUrl: string | null; recallMonths: number },
): string {
  const locale = row.locale;
  const phone = (row.branchId ? context.phones.get(row.branchId) : null) ?? context.defaultPhone;
  return fillTemplate(templates[reason][locale], {
    firstName: locale === "ar" && row.firstNameAr ? row.firstNameAr : row.firstName,
    lastName: row.lastName,
    clinic: context.clinicName,
    date: row.date ? messageDate(row.date, locale) : "",
    time: row.time ?? "",
    provider: row.provider ?? "",
    clinicPhone: phone ? formatPhone(phone) : "",
    months: String(context.recallMonths),
    bookingLink: context.bookingUrl ?? "",
  });
}
