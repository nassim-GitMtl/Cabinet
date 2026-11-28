import { timingSafeEqual } from "node:crypto";
import { runAutoReminders } from "@/features/reminders/server";
import { nodeRole } from "@/server/sync/node";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily automatic WhatsApp reminders (Vercel Cron, vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`;
 * without that secret configured the route refuses to run. Only the hosted (cloud) copy sends messages.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Unauthorized", { status: 401 });
  if ((await nodeRole()) !== "cloud") return Response.json({ skipped: "clinic computer" });
  const summary = await runAutoReminders();
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
