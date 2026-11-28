import { getFormatter, getTranslations } from "next-intl/server";
import { HourglassIcon, LockIcon } from "lucide-react";
import { normalizePhone } from "@/lib/phone";
import { trialUrgent } from "@/lib/trial";
import type { ClinicContext } from "@/server/auth/context";

/** Platform contact shown to trial clinics (PLATFORM_CONTACT_PHONE / PLATFORM_CONTACT_EMAIL). */
export function platformContact(env: Record<string, string | undefined> = process.env) {
  const phone = normalizePhone(env.PLATFORM_CONTACT_PHONE, "DZ");
  const email = env.PLATFORM_CONTACT_EMAIL?.trim() || null;
  return { phone, whatsApp: phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : null, email };
}

/** Top-of-page notice while a clinic is on trial; once over, explains the view-only mode and how to continue. */
export async function TrialNotice({ ctx }: { ctx: ClinicContext }) {
  if (!ctx.trial.onTrial || ctx.readOnlyCopy) return null;
  const [t, format] = await Promise.all([getTranslations("trial.notice"), getFormatter()]);
  const contact = platformContact();
  const links = <>
    {contact.whatsApp ? <a href={contact.whatsApp} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{t("whatsApp")}</a> : null}
    {contact.phone ? <a href={`tel:${contact.phone}`} className="font-medium text-primary hover:underline" dir="ltr">{contact.phone}</a> : null}
    {contact.email ? <a href={`mailto:${contact.email}`} className="font-medium text-primary hover:underline" dir="ltr">{contact.email}</a> : null}
  </>;
  if (ctx.trial.expired) {
    return <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
      <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div><p className="font-medium">{t("expiredTitle")}</p><p className="text-muted-foreground">{t("expiredBody")}</p><p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{links}</p></div>
    </div>;
  }
  const urgent = trialUrgent(ctx.trial);
  return <div role="status" className={`mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border p-3 text-sm ${urgent ? "border-warning/50 bg-warning/10" : "border-primary/25 bg-primary/5"}`}>
    <HourglassIcon className="size-4 shrink-0" aria-hidden />
    <p><span className="font-medium">{t("daysLeft", { days: ctx.trial.daysLeft ?? 0 })}</span> <span className="text-muted-foreground">{t("endsOn", { date: format.dateTime(ctx.trial.endsAt!, { dateStyle: "long", timeZone: ctx.organization.timezone }) })}</span></p>
    {links}
  </div>;
}
