import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Cloud API (Meta), the platform's own account, resold to clinics through the `whatsapp_reminders` module.
 * Server environment only (never NEXT_PUBLIC): the token is never logged or sent to a browser.
 *   WHATSAPP_ACCESS_TOKEN        permanent token of a system user of the WhatsApp Business account
 *   WHATSAPP_PHONE_NUMBER_ID     the sending number's id (not the number itself)
 *   WHATSAPP_API_VERSION         Graph API version, default v26.0
 *   WHATSAPP_REMINDER_TEMPLATE   approved utility template name, default "rappel_rendez_vous"
 *   WHATSAPP_TEMPLATE_LANGUAGES  languages the template is approved in, default "fr,ar,en" (others fall back to fr)
 *   WHATSAPP_APP_SECRET          app secret, to check the webhook signature
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN  random string also typed in the Meta webhook settings
 * Business-initiated messages must use an approved template (docs: developers.facebook.com, "Send messages").
 */

export type WhatsAppConfig = { token: string; phoneNumberId: string; version: string; template: string; languages: string[] };

export function whatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null {
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId || !/^\d{5,30}$/.test(phoneNumberId)) return null;
  const version = env.WHATSAPP_API_VERSION?.trim() || "v26.0";
  const template = env.WHATSAPP_REMINDER_TEMPLATE?.trim() || "rappel_rendez_vous";
  const languages = (env.WHATSAPP_TEMPLATE_LANGUAGES?.trim() || "fr,ar,en").split(",").map((l) => l.trim()).filter(Boolean);
  if (!/^v\d+\.\d+$/.test(version) || !/^[a-z0-9_]{1,512}$/.test(template)) return null;
  return { token, phoneNumberId, version, template, languages };
}

/** Template language for a patient: his language when the template exists in it, otherwise French. */
export function templateLanguage(config: WhatsAppConfig, locale: string) {
  return config.languages.includes(locale) ? locale : config.languages.includes("fr") ? "fr" : config.languages[0] ?? "fr";
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; code: string; title: string; retryable: boolean };

/**
 * Sends one approved template with its body variables in order ({{1}}, {{2}}…). The recipient is an E.164 number;
 * the API wants it without "+". `fetchImpl` is injectable for tests.
 */
export async function sendWhatsAppTemplate(
  config: WhatsAppConfig,
  input: { toE164: string; language: string; params: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const to = input.toE164.replace(/^\+/, "");
  if (!/^\d{8,15}$/.test(to)) return { ok: false, code: "invalid_number", title: "Invalid phone number", retryable: false };
  if (input.params.some((p) => !p.trim())) return { ok: false, code: "empty_parameter", title: "A template variable is empty", retryable: false };
  const url = `https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: config.template,
          language: { code: input.language },
          components: [{ type: "body", parameters: input.params.map((text) => ({ type: "text", text: text.slice(0, 1000) })) }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, code: "network", title: "WhatsApp could not be reached", retryable: true };
  }
  const body = (await response.json().catch(() => null)) as
    | { messages?: Array<{ id?: string }>; error?: { code?: number; message?: string; error_subcode?: number } }
    | null;
  const id = body?.messages?.[0]?.id;
  if (response.ok && id) return { ok: true, providerMessageId: id };
  const code = String(body?.error?.code ?? response.status);
  // Throttling and server errors can be retried; anything else (bad number, template, token) will fail again.
  const retryable = response.status === 429 || response.status >= 500 || code === "4" || code === "80007" || code === "130429" || code === "131016";
  return { ok: false, code, title: (body?.error?.message ?? `HTTP ${response.status}`).slice(0, 300), retryable };
}

/** Checks Meta's `X-Hub-Signature-256: sha256=<hex>` (HMAC-SHA256 of the raw body with the app secret). */
export function validWebhookSignature(rawBody: string, header: string | null, appSecret: string | undefined) {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type WhatsAppStatusEvent = { providerMessageId: string; status: string; at: Date; errorCode: string | null; errorTitle: string | null };

/** Message status events (sent / delivered / read / failed) out of a webhook payload; anything else is ignored. */
export function statusEvents(payload: unknown): WhatsAppStatusEvent[] {
  const events: WhatsAppStatusEvent[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return events;
  for (const entry of entries) {
    for (const change of ((entry as { changes?: unknown[] })?.changes ?? [])) {
      const statuses = (change as { value?: { statuses?: unknown[] } })?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses as Array<{ id?: unknown; status?: unknown; timestamp?: unknown; errors?: Array<{ code?: unknown; title?: unknown; message?: unknown }> }>) {
        if (typeof s.id !== "string" || typeof s.status !== "string") continue;
        const seconds = Number(s.timestamp);
        const error = s.errors?.[0];
        events.push({
          providerMessageId: s.id,
          status: s.status,
          at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
          errorCode: error?.code !== undefined ? String(error.code) : null,
          errorTitle: typeof error?.title === "string" ? error.title : typeof error?.message === "string" ? error.message : null,
        });
      }
    }
  }
  return events;
}
