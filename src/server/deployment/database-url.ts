const NEON_HOST_SUFFIX = ".neon.tech";
const NEON_POOLER_MARKER = "-pooler.";

export const RUNTIME_DATABASE_ROLE = "cabinet_app";

function parseDatabaseUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Database URL is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Database URL must use postgres:// or postgresql://");
  }
  if (!url.hostname || !url.pathname.slice(1) || !url.username) {
    throw new Error("Database URL must include a host, database, and user");
  }
  return url;
}

export function isNeonDatabaseUrl(raw: string) {
  try {
    return parseDatabaseUrl(raw).hostname.endsWith(NEON_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export function isPooledNeonUrl(raw: string) {
  try {
    const host = parseDatabaseUrl(raw).hostname;
    return host.endsWith(NEON_HOST_SUFFIX) && host.includes(NEON_POOLER_MARKER);
  } catch {
    return false;
  }
}

/**
 * Postgres.js does not implement libpq's `channel_binding` URL option and
 * otherwise forwards unknown query parameters to PostgreSQL as startup
 * parameters. Neon already requires TLS, so remove only that unsupported
 * client hint while preserving sslmode=require.
 */
export function normalizeDatabaseUrl(raw: string) {
  const url = parseDatabaseUrl(raw);
  url.searchParams.delete("channel_binding");
  return url.toString();
}

export function validateNeonAdminUrl(raw: string) {
  const url = parseDatabaseUrl(raw);
  if (!url.hostname.endsWith(NEON_HOST_SUFFIX)) {
    throw new Error("DATABASE_URL_ADMIN must point to a Neon host ending in .neon.tech");
  }
  if (url.hostname.includes(NEON_POOLER_MARKER)) {
    throw new Error("DATABASE_URL_ADMIN must use the direct Neon endpoint, not the -pooler endpoint");
  }
  if (url.searchParams.get("sslmode") !== "require") {
    throw new Error("DATABASE_URL_ADMIN must include sslmode=require");
  }
  if (decodeURIComponent(url.username) === RUNTIME_DATABASE_ROLE) {
    throw new Error("DATABASE_URL_ADMIN must use the Neon owner role, not cabinet_app");
  }
}

export function buildNeonRuntimeUrl(adminUrl: string, password: string) {
  validateNeonAdminUrl(adminUrl);
  if (password.length < 24) {
    throw new Error("DATABASE_RUNTIME_PASSWORD must contain at least 24 characters");
  }

  const url = parseDatabaseUrl(adminUrl);
  const [endpoint, ...rest] = url.hostname.split(".");
  if (!endpoint || rest.length === 0) throw new Error("Unexpected Neon hostname");
  url.hostname = `${endpoint}-pooler.${rest.join(".")}`;
  url.username = RUNTIME_DATABASE_ROLE;
  url.password = password;
  url.searchParams.set("sslmode", "require");
  url.searchParams.delete("channel_binding");
  return url.toString();
}

export function redactDatabaseUrl(raw: string) {
  const url = parseDatabaseUrl(raw);
  if (url.password) url.password = "REDACTED";
  return url.toString();
}

export function databasePoolMax(raw = process.env.DATABASE_POOL_MAX) {
  if (raw === undefined || raw === "") return 10;
  if (!/^\d+$/.test(raw)) throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 20");
  const value = Number(raw);
  if (value < 1 || value > 20) throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 20");
  return value;
}
