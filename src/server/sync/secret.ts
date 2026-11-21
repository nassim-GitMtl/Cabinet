// Protects the node key stored on the clinic computer (AES-256-GCM). No server-only imports.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const material = process.env.MFA_ENCRYPTION_KEY ?? (process.env.NODE_ENV === "production" ? null : process.env.DATABASE_URL);
  if (!material) throw new Error("MFA_ENCRYPTION_KEY is required in production");
  return createHash("sha256").update(`cabinet-sync-v1:${material}`).digest();
}

export function protectNodeKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["s1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function revealNodeKey(value: string): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "s1" || !iv || !tag || !encrypted) throw new Error("invalid protected node key");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
