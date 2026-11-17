// Applies Drizzle migrations using the schema-owner connection.
// Usage: npm run db:migrate            (DATABASE_URL_ADMIN)
//        npm run db:migrate -- --test  (TEST_DATABASE_URL_ADMIN)
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function runMigrations(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const useTest = process.argv.includes("--test");
  const url = useTest ? process.env.TEST_DATABASE_URL_ADMIN : process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("Admin database URL is not set");
  runMigrations(url)
    .then(() => console.log(`Migrations applied (${useTest ? "test" : "main"} database).`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
