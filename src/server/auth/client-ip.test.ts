import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "./client-ip";

const h = (values: Record<string, string>) => new Headers(values);

describe("client IP resolution", () => {
  it("prefers the clinic proxy's overwritten header", () => {
    expect(clientIpFromHeaders(h({ "x-cdp-client-ip": "203.0.113.8", "x-forwarded-for": "198.51.100.2" })))
      .toBe("203.0.113.8");
  });

  it("accepts validated forwarded IPv4/IPv6 addresses and common port forms", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }))).toBe("198.51.100.9");
    expect(clientIpFromHeaders(h({ "x-real-ip": "[2001:db8::4]:443" }))).toBe("2001:db8::4");
    expect(clientIpFromHeaders(h({ "x-real-ip": "192.0.2.4:50123" }))).toBe("192.0.2.4");
  });

  it("rejects malformed and attacker-controlled non-address values", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(clientIpFromHeaders(h({ "x-cdp-client-ip": "evil", "x-real-ip": "203.0.113.2" }))).toBe("203.0.113.2");
  });
});
