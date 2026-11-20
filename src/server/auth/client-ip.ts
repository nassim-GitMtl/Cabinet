import { isIP } from "node:net";

function normalizeAddress(value: string | null): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 80) return null;
  if (isIP(candidate)) return candidate.toLowerCase();

  // Be conservative, but accept the common host:port forms used by reverse proxies.
  const bracketed = /^\[([^\]]+)](?::\d{1,5})?$/.exec(candidate);
  if (bracketed?.[1] && isIP(bracketed[1])) return bracketed[1].toLowerCase();
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(candidate);
  if (ipv4WithPort?.[1] && isIP(ipv4WithPort[1])) return ipv4WithPort[1];
  return null;
}

/**
 * The clinic Caddy proxy overwrites x-cdp-client-ip. The standard proxy headers are fallbacks for
 * development/other deployments and are still validated before use.
 */
export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const trusted = normalizeAddress(headers.get("x-cdp-client-ip"));
  if (trusted) return trusted;
  const forwarded = headers.get("x-forwarded-for")?.split(",", 1)[0] ?? null;
  return normalizeAddress(forwarded) ?? normalizeAddress(headers.get("x-real-ip"));
}
