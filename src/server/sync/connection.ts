// Connection pool for the sync login (`cabinet_sync`). Separate from the app pool so only sync code can
// switch business triggers off while applying replicated rows. No server-only imports.
import postgres from "postgres";
import { normalizeDatabaseUrl } from "@/server/deployment/database-url";

const globalForSync = globalThis as unknown as { __cabinetSyncSql?: postgres.Sql };

export function syncDatabaseConfigured(): boolean {
  return Boolean(process.env.SYNC_DATABASE_URL);
}

export function syncSql(): postgres.Sql {
  const url = process.env.SYNC_DATABASE_URL;
  if (!url) throw new Error("SYNC_DATABASE_URL is not set");
  return (globalForSync.__cabinetSyncSql ??= postgres(normalizeDatabaseUrl(url), {
    max: 3, prepare: false, idle_timeout: 30, connect_timeout: 30, onnotice: () => {},
    connection: { application_name: "cabinet-dentaire-sync" },
  }));
}
