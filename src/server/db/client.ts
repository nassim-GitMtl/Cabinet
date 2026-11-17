import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof createDb>;

export function createDb(url: string, max = 10) {
  const client = postgres(url, { max, prepare: true, idle_timeout: 30 });
  return drizzle(client, { schema, casing: "snake_case" });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __cabinetDb?: Db };

/** Runtime connection as `cabinet_app` (RLS enforced). */
export const db: Db =
  globalForDb.__cabinetDb ??
  (globalForDb.__cabinetDb = createDb(
    process.env.DATABASE_URL ??
      (() => {
        throw new Error("DATABASE_URL is not set");
      })(),
  ));

export type Database = Db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
