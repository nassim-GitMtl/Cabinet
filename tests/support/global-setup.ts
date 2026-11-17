import "dotenv/config";
import postgres from "postgres";
import { runMigrations } from "../../scripts/migrate";

/** Resets the test database schema and applies all migrations once per run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL_ADMIN;
  if (!url) throw new Error("TEST_DATABASE_URL_ADMIN is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP SCHEMA IF EXISTS app_private CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    CREATE SCHEMA public;
    GRANT USAGE ON SCHEMA public TO cabinet_app;
  `);
  await sql.end();
  await runMigrations(url);
}
