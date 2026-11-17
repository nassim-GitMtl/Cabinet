import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(input: Buffer) {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[Number.parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

function base32Decode(input: string) {
  let bits = "";
  for (const char of input.replace(/=|\s|-/g, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  return Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
}

function encryptionKey() {
  const material = process.env.MFA_ENCRYPTION_KEY ?? (process.env.NODE_ENV === "production" ? null : process.env.DATABASE_URL);
  if (!material) throw new Error("MFA_ENCRYPTION_KEY is required in production");
  return createHash("sha256").update(`cabinet-mfa-v1:${material}`).digest();
}

export function protectTotpSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function revealTotpSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("invalid protected TOTP secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, at = Date.now()) {
  const counter = Math.floor(at / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, at = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((window) => {
    const expected = Buffer.from(totpCode(secret, at + window * 30_000));
    const provided = Buffer.from(code);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  });
}

export const hashRecoveryCode = (code: string) => createHash("sha256").update(code.replace(/\s|-/g, "").toUpperCase()).digest("hex");
export const generateRecoveryCodes = () => Array.from({ length: 8 }, () => randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-"));

export function totpUri(secret: string, email: string, issuer = "Cabinet Dentaire Pro") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
