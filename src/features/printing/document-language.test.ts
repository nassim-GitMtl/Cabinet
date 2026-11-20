import { describe, expect, it } from "vitest";
import { documentDirection, documentLocale, resolveDocumentLanguage } from "./document-language";
import { documentTranslation } from "./document-translations";

describe("financial document language", () => {
  it("defaults Arabic patients to Arabic and every other patient to French", () => {
    expect(resolveDocumentLanguage(undefined, "ar")).toBe("ar");
    expect(resolveDocumentLanguage(undefined, "fr")).toBe("fr");
    expect(resolveDocumentLanguage(undefined, "en")).toBe("fr");
  });

  it("accepts only the supported per-document choices", () => {
    expect(resolveDocumentLanguage("fr", "ar")).toBe("fr");
    expect(resolveDocumentLanguage("ar", "fr")).toBe("ar");
    expect(resolveDocumentLanguage("bilingual", "fr")).toBe("bilingual");
    expect(resolveDocumentLanguage("en", "ar")).toBe("ar");
    expect(resolveDocumentLanguage(["ar"], "fr")).toBe("fr");
  });

  it("uses RTL only for Arabic-only documents", () => {
    expect(documentDirection("ar")).toBe("rtl");
    expect(documentDirection("fr")).toBe("ltr");
    expect(documentDirection("bilingual")).toBe("ltr");
    expect(documentLocale("ar")).toBe("ar");
    expect(documentLocale("bilingual")).toBe("fr");
  });

  it("loads the requested bundled document language independently of the UI locale", () => {
    expect(documentTranslation("fr", "billing.invoiceTitle")).toBe("Facture");
    expect(documentTranslation("ar", "billing.invoiceTitle")).toBe("فاتورة");
    expect(documentTranslation("ar", "statement.title")).toBe("كشف حساب");
  });
});
