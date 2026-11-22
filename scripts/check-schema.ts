// Deployment guard (Vercel build step, see package.json "vercel-build"): refuses to put code live while its database
// has not received all of this code's migrations. A refused build leaves the previous version live instead of a new
// version that fails at runtime. Waits a few minutes first, so a migration applied in parallel (GitHub Action
// "Database migrations") can land. Outside Vercel it does nothing unless called with --force.
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "../src/server/deployment/database-url";

const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
const expected = journal.entries.length;
const waitSeconds = Number(process.env.SCHEMA_WAIT_SECONDS ?? 300);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function applied(url: string): Promise<number | null> {
  const sql = postgres(normalizeDatabaseUrl(url), { max: 1, prepare: false, connect_timeout: 20, onnotice: () => {} });
  try {
    const [row] = await sql<{ n: number }[]>`select app_private.schema_migrations_applied() as n`;
    return row?.n ?? null;
  } catch (error) {
    // Older than migration 0046: the function does not exist yet, so the database is behind.
    if ((error as { code?: string }).code === "42883") return null;
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  if (process.env.VERCEL !== "1" && !process.argv.includes("--force")) return;
  if (process.env.SKIP_SCHEMA_CHECK === "1") {
    console.warn("schema check skipped (SKIP_SCHEMA_CHECK=1)");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("schema check skipped: DATABASE_URL is not set for this deployment");
    return;
  }
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const count = await applied(url);
    if (count !== null && count >= expected) {
      console.log(`schema check ok: database has ${count} migrations, code needs ${expected}`);
      return;
    }
    if (Date.now() >= deadline) {
      console.error(
        `\nDatabase is behind this code: it has ${count ?? "fewer than 47"} migrations, the code needs ${expected} ` +
        `(latest: ${journal.entries.at(-1)?.tag}).\nThe previous version stays live. Apply the migrations ` +
        `(GitHub Action "Database migrations", or: DATABASE_URL_ADMIN=<direct owner URL> npm run db:migrate), then redeploy.\n`,
      );
      process.exit(1);
    }
    console.log(`waiting for migrations: database has ${count ?? "<47"}, code needs ${expected}…`);
    await sleep(10_000);
  }
}

main().catch((error: unknown) => {
  console.error("schema check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
