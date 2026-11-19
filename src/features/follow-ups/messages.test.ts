import { describe, expect, it } from "vitest";
import { asMessageLocale, fillTemplate, messageDate, smsUrl, telUrl, whatsappUrl } from "./messages";

describe("follow-up messages", () => {
  it("fills placeholders, keeps unknown ones visible and tidies empty values", () => {
    expect(fillTemplate("Bonjour {firstName}, RDV le {date} à {time}.", { firstName: "Karim", date: "mardi 24/11/2026", time: "09:30" }))
      .toBe("Bonjour Karim, RDV le mardi 24/11/2026 à 09:30.");
    expect(fillTemplate("Appelez le {clinicPhone} {bookingLink}.", { clinicPhone: "0661 00 00 01", bookingLink: "" })).toBe("Appelez le 0661 00 00 01.");
    expect(fillTemplate("Bonjour {prenom}", { firstName: "A" })).toBe("Bonjour {prenom}");
  });

  it("builds WhatsApp, SMS and phone links from E.164 numbers", () => {
    expect(whatsappUrl("+213661000001", "Salut & à demain")).toBe("https://wa.me/213661000001?text=Salut%20%26%20%C3%A0%20demain");
    expect(smsUrl("+213661000001", "Rappel")).toBe("sms:+213661000001?&body=Rappel");
    expect(telUrl("+213 661 00 00 01")).toBe("tel:+213661000001");
  });

  it("formats the appointment day in the patient's language with Latin digits", () => {
    expect(messageDate("2026-11-24", "fr")).toBe("mardi 24/11/2026");
    expect(messageDate("2026-11-24", "en")).toBe("Tuesday 24/11/2026");
    expect(messageDate("2026-11-24", "ar")).toBe("الثلاثاء 24/11/2026");
    expect(asMessageLocale("de")).toBe("fr");
  });
});
