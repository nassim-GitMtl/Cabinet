import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// OWASP-recommended scrypt parameters (N=2^15, r=8, p=3). Format:
// scrypt$N$r$p$saltB64$hashB64 so parameters can be raised later and old
// hashes still verify (rehash on next login when params change).
const N = 1 << 15;
const R = 8;
const P = 3;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const maxmem = (n: number, r: number, p: number) => 128 * n * r * p + 16 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: maxmem(N, R, P),
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    ...params,
    maxmem: maxmem(params.N, params.r, params.p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Minimum policy: length over complexity (NIST SP 800-63B). */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 10) return "password.tooShort";
  if (password.length > 200) return "password.tooLong";
  return null;
}
