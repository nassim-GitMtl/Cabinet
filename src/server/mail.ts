import "server-only";

import { createTranslator } from "next-intl";
import nodemailer from "nodemailer";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import type { ResetEmail } from "./auth/password-reset";

export type MailSettings = { host: string; port: number; secure: boolean; user: string | null; password: string | null; from: string };

/**
 * Outgoing email is optional (the clinic server works without internet). It is on only when SMTP_HOST and
 * SMTP_FROM are set. Port 465 implies TLS from the start; other ports upgrade with STARTTLS when offered.
 */
export function mailSettings(env: Record<string, string | undefined> = process.env): MailSettings | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  if (!host || !from) return null;
  const port = Number(env.SMTP_PORT?.trim() || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const secure = env.SMTP_SECURE ? ["1", "true", "yes"].includes(env.SMTP_SECURE.trim().toLowerCase()) : port === 465;
  return { host, port, secure, user: env.SMTP_USER?.trim() || null, password: env.SMTP_PASSWORD || null, from };
}

/**
 * Address put in emailed links. Only configuration is trusted (never the request Host header, which an
 * attacker controls): the internet address when there is one, otherwise the clinic-network address.
 */
export function mailLinkBase(env: Record<string, string | undefined> = process.env): string | null {
  const value = (env.PUBLIC_APP_URL?.trim() || env.APP_URL?.trim() || "").replace(/\/+$/, "");
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/** "Forgot password" by email is offered only when both are configured. */
export function passwordEmailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return mailSettings(env) !== null && mailLinkBase(env) !== null;
}

const MESSAGES = { fr, en, ar } as const;

export function resetEmailContent(mail: ResetEmail): { subject: string; text: string } {
  const locale = mail.locale === "ar" || mail.locale === "en" ? mail.locale : "fr";
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "passwordReset.email" });
  return { subject: t("subject"), text: t("body", { name: mail.fullName, link: mail.link, minutes: mail.minutes }) };
}

export async function sendResetEmail(mail: ResetEmail): Promise<void> {
  const settings = mailSettings();
  if (!settings) return;
  const transport = nodemailer.createTransport({
    host: settings.host, port: settings.port, secure: settings.secure,
    auth: settings.user ? { user: settings.user, pass: settings.password ?? "" } : undefined,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  const { subject, text } = resetEmailContent(mail);
  await transport.sendMail({ from: settings.from, to: mail.to, subject, text });
}
