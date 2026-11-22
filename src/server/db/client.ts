import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { databasePoolMax, normalizeDatabaseUrl } from "@/server/deployment/database-url";

type Db = ReturnType<typeof createDb>;

export function createDb(url: string, max = databasePoolMax()) {
  const client = postgres(normalizeDatabaseUrl(url), {
    max,
    prepare: true,
    idle_timeout: 30,
    connect_timeout: 30,
    connection: { application_name: "cabinet-dentaire-web" },
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __cabinetDb?: Db };

function getDb(): Db {
  if (globalForDb.__cabinetDb) return globalForDb.__cabinetDb;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  globalForDb.__cabinetDb = createDb(url);
  return globalForDb.__cabinetDb;
}

/** Runtime connection as `cabinet_app` (RLS enforced); created on first use. */
export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const database = getDb();
    const value = Reflect.get(database, property, database);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export type Database = Db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
