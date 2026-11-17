import { describe, expect, it } from "vitest";
import { generateTotpSecret, hashRecoveryCode, protectTotpSecret, revealTotpSecret, totpCode, verifyTotp } from "./totp";

describe("TOTP", () => {
  it("generates, protects and verifies time-based codes", () => {
    process.env.MFA_ENCRYPTION_KEY = "test-encryption-key";
    const secret = generateTotpSecret();
    expect(revealTotpSecret(protectTotpSecret(secret))).toBe(secret);
    const at = Date.UTC(2026, 10, 17, 12, 0, 0);
    const code = totpCode(secret, at);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, at)).toBe(true);
    expect(verifyTotp(secret, "000000", at)).toBe(false);
    expect(hashRecoveryCode("ABCDE-12345")).toBe(hashRecoveryCode("abcde12345"));
  });
});
