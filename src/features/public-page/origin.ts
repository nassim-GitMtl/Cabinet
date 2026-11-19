import "server-only";

import { headers } from "next/headers";

/**
 * Base URL for links patients open from outside (public page, QR poster). PUBLIC_APP_URL wins when the
 * clinic has an internet-facing address; otherwise the address staff use right now.
 */
export async function publicOrigin(): Promise<{ origin: string; localOnly: boolean }> {
  const configured = process.env.PUBLIC_APP_URL?.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = configured || (host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : (process.env.APP_URL ?? ""));
  return { origin, localOnly: isLocalAddress(origin) };
}

/** True for addresses only reachable inside the clinic network (LAN server, development). */
export function isLocalAddress(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".localhost") || hostname.endsWith(".lan")
      || /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
      || hostname === "[::1]";
  } catch {
    return true;
  }
}
