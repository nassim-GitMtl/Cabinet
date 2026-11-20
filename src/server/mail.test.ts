import { describe, expect, it } from "vitest";
import { mailLinkBase, mailSettings, passwordEmailEnabled, resetEmailContent } from "./mail";

describe("outgoing email settings", () => {
  it("is off unless host and sender are set; port 465 implies TLS", () => {
    expect(mailSettings({})).toBeNull();
    expect(mailSettings({ SMTP_HOST: "smtp.example.test" })).toBeNull();
    expect(mailSettings({ SMTP_HOST: "smtp.example.test", SMTP_FROM: "Cabinet <no-reply@example.test>" }))
      .toEqual({ host: "smtp.example.test", port: 587, secure: false, user: null, password: null, from: "Cabinet <no-reply@example.test>" });
    expect(mailSettings({ SMTP_HOST: "h", SMTP_FROM: "f", SMTP_PORT: "465", SMTP_USER: "u", SMTP_PASSWORD: "p" })).toMatchObject({ port: 465, secure: true, user: "u", password: "p" });
    expect(mailSettings({ SMTP_HOST: "h", SMTP_FROM: "f", SMTP_PORT: "2525", SMTP_SECURE: "true" })).toMatchObject({ port: 2525, secure: true });
    expect(mailSettings({ SMTP_HOST: "h", SMTP_FROM: "f", SMTP_PORT: "abc" })).toBeNull();
  });

  it("links use the configured address only (internet address first), never the request host", () => {
    expect(mailLinkBase({ APP_URL: "https://192.168.1.10/" })).toBe("https://192.168.1.10");
    expect(mailLinkBase({ APP_URL: "https://192.168.1.10", PUBLIC_APP_URL: "https://cabinet.example.dz/" })).toBe("https://cabinet.example.dz");
    expect(mailLinkBase({ APP_URL: "javascript:alert(1)" })).toBeNull();
    expect(mailLinkBase({})).toBeNull();
    expect(passwordEmailEnabled({ SMTP_HOST: "h", SMTP_FROM: "f" })).toBe(false);
    expect(passwordEmailEnabled({ SMTP_HOST: "h", SMTP_FROM: "f", APP_URL: "https://cabinet.lan" })).toBe(true);
  });

  it("writes the email in the account's language with the link and validity", () => {
    const mail = { to: "a@example.test", fullName: "Samia", link: "https://cabinet.example.dz/reset-password/abc", minutes: 60 };
    for (const locale of ["fr", "en", "ar", "es"]) {
      const content = resetEmailContent({ ...mail, locale });
      expect(content.subject.length).toBeGreaterThan(5);
      expect(content.text).toContain(mail.link);
      expect(content.text).toContain("Samia");
      expect(content.text).toContain("60");
    }
    expect(resetEmailContent({ ...mail, locale: "es" }).subject).toBe(resetEmailContent({ ...mail, locale: "fr" }).subject);
  });
});
