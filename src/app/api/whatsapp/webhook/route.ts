import { timingSafeEqual } from "node:crypto";
import { applyWhatsAppStatuses } from "@/features/reminders/server";
import { statusEvents, validWebhookSignature } from "@/server/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Meta's one-time webhook check: echo the challenge when the verify token matches. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (token && sp.get("hub.mode") === "subscribe" && same(sp.get("hub.verify_token") ?? "", token)) {
    return new Response(sp.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Delivery receipts (sent / delivered / read / failed), signed with the app secret over the raw body. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response("Too large", { status: 413 });
  if (!validWebhookSignature(raw, request.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  await applyWhatsAppStatuses(statusEvents(payload));
  return new Response("OK");
}
