// Grants or revokes the metadata-only platform console role.
// Usage: npm run platform:operator -- person@example.com [--revoke]
import "dotenv/config";
import postgres from "postgres";

export async function setPlatformOperator(databaseUrl: string, email: string, enabled: boolean) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ id: string }[]>`
      update public.users
         set platform_role = ${enabled ? "operator" : "none"}, updated_at = now()
       where lower(email) = lower(${email.trim()}) and status = 'active'
       returning id`;
    if (!rows.length) throw new Error("No active account uses this email address.");
    await sql`insert into public.audit_events (organization_id, actor_type, actor_user_id, action, entity_type, entity_id)
              values (null, 'platform', ${rows[0]!.id}, ${enabled ? "platform.operator.granted" : "platform.operator.revoked"}, 'user', ${rows[0]!.id})`;
  } finally {
    await sql.end();
  }
}

if (/platform-operator\.(ts|mjs)$/.test(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const email = args.find((value) => !value.startsWith("--"));
  const databaseUrl = process.env.DATABASE_URL_ADMIN;
  if (!email || !databaseUrl) {
    console.error("Usage: platform-operator <email> [--revoke]   (needs DATABASE_URL_ADMIN)");
    process.exit(2);
  }
  setPlatformOperator(databaseUrl, email, !args.includes("--revoke"))
    .then(() => console.log(args.includes("--revoke") ? "Platform operator access revoked." : "Platform operator access granted."))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
