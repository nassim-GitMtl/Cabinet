import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sendWhatsAppTemplate, statusEvents, templateLanguage, validWebhookSignature, whatsAppConfig } from "./whatsapp";

const env = { WHATSAPP_ACCESS_TOKEN: "token-abc", WHATSAPP_PHONE_NUMBER_ID: "1234567890" } as unknown as NodeJS.ProcessEnv;

describe("WhatsApp Cloud API client", () => {
  it("is off until the token and number id are set, with safe defaults", () => {
    expect(whatsAppConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(whatsAppConfig({ ...env, WHATSAPP_PHONE_NUMBER_ID: "+213 555" } as NodeJS.ProcessEnv)).toBeNull();
    const config = whatsAppConfig(env)!;
    expect(config).toMatchObject({ version: "v26.0", template: "rappel_rendez_vous", languages: ["fr", "ar", "en"] });
    expect(templateLanguage(config, "ar")).toBe("ar");
    expect(templateLanguage({ ...config, languages: ["fr"] }, "ar")).toBe("fr");
  });

  it("sends an approved template with the variables in order", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.ABC" }] }));
    const result = await sendWhatsAppTemplate(whatsAppConfig(env)!, { toE164: "+213661000001", language: "fr", params: ["Karim", "Cabinet", "mardi 25/11/2026", "10:00", "0661 00 00 00"] }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, providerMessageId: "wamid.ABC" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/1234567890/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-abc");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "213661000001", type: "template", template: { name: "rappel_rendez_vous", language: { code: "fr" } } });
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Karim", "Cabinet", "mardi 25/11/2026", "10:00", "0661 00 00 00"]);
  });

  it("tells retryable failures from final ones and never calls out for bad input", async () => {
    const config = whatsAppConfig(env)!;
    const call = (status: number, body: unknown) => sendWhatsAppTemplate(config, { toE164: "+213661000001", language: "fr", params: ["a"] }, (async () => Response.json(body, { status })) as unknown as typeof fetch);
    expect(await call(400, { error: { code: 131026, message: "Message undeliverable" } })).toMatchObject({ ok: false, code: "131026", retryable: false });
    expect(await call(429, { error: { code: 130429, message: "Rate limit" } })).toMatchObject({ ok: false, retryable: true });
    expect(await call(503, null)).toMatchObject({ ok: false, code: "503", retryable: true });
    const network = await sendWhatsAppTemplate(config, { toE164: "+213661000001", language: "fr", params: ["a"] }, (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    expect(network).toMatchObject({ ok: false, code: "network", retryable: true });
    const never = vi.fn();
    expect(await sendWhatsAppTemplate(config, { toE164: "+12", language: "fr", params: ["a"] }, never as unknown as typeof fetch)).toMatchObject({ code: "invalid_number" });
    expect(await sendWhatsAppTemplate(config, { toE164: "+213661000001", language: "fr", params: [" "] }, never as unknown as typeof fetch)).toMatchObject({ code: "empty_parameter" });
    expect(never).not.toHaveBeenCalled();
  });

  it("checks the webhook signature on the raw body and reads delivery receipts", () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [
        { id: "wamid.1", status: "delivered", timestamp: "1795400000" },
        { id: "wamid.2", status: "failed", timestamp: "1795400100", errors: [{ code: 131026, title: "Message undeliverable" }] },
      ] } }] }],
    });
    const header = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    expect(validWebhookSignature(raw, header, "app-secret")).toBe(true);
    expect(validWebhookSignature(`${raw} `, header, "app-secret")).toBe(false);
    expect(validWebhookSignature(raw, header, undefined)).toBe(false);
    expect(validWebhookSignature(raw, "sha256=00", "app-secret")).toBe(false);
    expect(statusEvents(JSON.parse(raw))).toEqual([
      { providerMessageId: "wamid.1", status: "delivered", at: new Date(1795400000 * 1000), errorCode: null, errorTitle: null },
      { providerMessageId: "wamid.2", status: "failed", at: new Date(1795400100 * 1000), errorCode: "131026", errorTitle: "Message undeliverable" },
    ]);
    expect(statusEvents({ nonsense: true })).toEqual([]);
  });
});
