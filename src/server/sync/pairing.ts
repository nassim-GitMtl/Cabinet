// Pairing a clinic computer with the cloud copy, and recognising it afterwards. No server-only imports.
import { createHash, randomBytes, randomInt } from "node:crypto";
import type postgres from "postgres";
import { currentXmax } from "./engine";

type Sql = postgres.Sql;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Unambiguous letters and digits (no 0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 16 characters (~79 bits) shown as ABCD-EFGH-JKMN-PQRS; typed once on the clinic computer within 30 minutes. */
export function newPairingCode(): string {
  const chars = Array.from({ length: 16 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** Case, spaces and dashes do not matter when the code is typed. */
export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const hashPairingCode = (code: string) => sha256(`pairing:${normalizePairingCode(code)}`);
export const hashNodeKey = (key: string) => sha256(`node:${key}`);

export type PairingClaim = { nodeId: string; organizationId: string; nodeKey: string; pullFrom: string };

/**
 * Exchanges a pairing code for a node key. The clinic computer is in charge from this moment; `pullFrom` is the
 * point after which cloud-side changes are recorded (the first full copy may be read once it is safe).
 */
export async function claimPairing(sql: Sql, code: string): Promise<PairingClaim | null> {
  if (normalizePairingCode(code).length !== 16) return null;
  const nodeKey = randomBytes(32).toString("base64url");
  const [row] = await sql<{ node_id: string; organization_id: string }[]>`
    select * from app_private.claim_sync_pairing(${hashPairingCode(code)}, ${hashNodeKey(nodeKey)})`;
  if (!row) return null;
  return { nodeId: row.node_id, organizationId: row.organization_id, nodeKey, pullFrom: await currentXmax(sql) };
}

export async function resolveNodeKey(sql: Sql, nodeKey: string): Promise<{ nodeId: string; organizationId: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(nodeKey)) return null;
  const [row] = await sql<{ node_id: string; organization_id: string }[]>`
    select * from app_private.resolve_sync_node(${hashNodeKey(nodeKey)})`;
  return row ? { nodeId: row.node_id, organizationId: row.organization_id } : null;
}
