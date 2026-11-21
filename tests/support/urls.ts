/** Second test database: the "clinic computer" in offline-sync engine tests. */
export const PEER_DATABASE = "cabinet_test_peer";
/** Third test database: a fresh clinic computer paired through the real endpoints and worker. */
export const NODE_DATABASE = "cabinet_test_node";
/** Development/test password of the sync login (same as docker/postgres/init.sql and .env.example). */
export const SYNC_TEST_PASSWORD = "cabinet_sync_dev";

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export function withUser(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}
