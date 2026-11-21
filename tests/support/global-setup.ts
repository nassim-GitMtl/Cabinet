import "dotenv/config";
import postgres from "postgres";
import { runMigrations } from "../../scripts/migrate";
import { NODE_DATABASE, PEER_DATABASE, SYNC_TEST_PASSWORD, withDatabase } from "./urls";

async function resetSchemas(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP SCHEMA IF EXISTS app_private CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    CREATE SCHEMA public;
    GRANT USAGE ON SCHEMA public TO cabinet_app;
  `);
  await sql.end();
}

/**
 * Resets the test database schema and applies all migrations once per run. A second database plays the clinic
 * computer for the offline-sync tests (node role "clinic"); the sync login gets a test password.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL_ADMIN;
  if (!url) throw new Error("TEST_DATABASE_URL_ADMIN is not set");
  await resetSchemas(url);
  await runMigrations(url);

  const admin = postgres(url, { max: 1, onnotice: () => {} });
  for (const name of [PEER_DATABASE, NODE_DATABASE]) {
    const [exists] = await admin`select 1 as one from pg_database where datname = ${name}`;
    if (!exists) await admin.unsafe(`CREATE DATABASE ${name} OWNER "${decodeURIComponent(new URL(url).username)}"`);
  }
  await admin.unsafe(`ALTER ROLE cabinet_sync WITH LOGIN PASSWORD '${SYNC_TEST_PASSWORD}'`);
  await admin.end();

  for (const name of [PEER_DATABASE, NODE_DATABASE]) {
    const peerUrl = withDatabase(url, name);
    await resetSchemas(peerUrl);
    await runMigrations(peerUrl);
    const peer = postgres(peerUrl, { max: 1, onnotice: () => {} });
    await peer`update app_private.node_settings set node_role = 'clinic'`;
    await peer.end();
  }
}
