// Creates a single-use password reset link from the clinic server itself, for when nobody can sign in to
// create one (typically the owner forgot their password and no email is configured).
// Usage: npm run staff:reset-link -- person@example.com [--reset-mfa]
// Clinic server: ./reset-password.sh person@example.com [--reset-mfa]   (deploy/clinic)
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

export const SERVER_RESET_HOURS = 2;

export async function createServerResetLink(databaseUrl: string, email: string, opts: { resetMfa: boolean }) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const [user] = await tx<{ id: string; status: string }[]>`
        select id, status from public.users where lower(email) = lower(${email.trim()}) for update`;
      if (!user) return { error: "No account uses this email address." } as const;
      if (user.status !== "active") return { error: "This account is disabled." } as const;
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + SERVER_RESET_HOURS * 3_600_000);
      await tx`update public.staff_password_resets set revoked_at = now()
                where user_id = ${user.id} and used_at is null and revoked_at is null`;
      const [reset] = await tx<{ id: string }[]>`
        insert into public.staff_password_resets (user_id, token_hash, channel, reset_mfa, expires_at)
        values (${user.id}, ${createHash("sha256").update(token).digest("hex")}, 'server_command', ${opts.resetMfa}, ${expiresAt})
        returning id`;
      await tx`insert into public.audit_events (organization_id, actor_type, action, entity_type, entity_id, metadata)
               values (null, 'platform', 'auth.password_reset.server_link_created', 'user', ${user.id},
                       ${tx.json({ resetId: reset!.id, resetMfa: opts.resetMfa })})`;
      return { token, expiresAt } as const;
    });
  } finally {
    await sql.end();
  }
}

if (/staff-reset-link\.(ts|mjs)$/.test(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  const url = process.env.DATABASE_URL_ADMIN;
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  if (!email || !url) {
    console.error("Usage: staff-reset-link <email> [--reset-mfa]   (needs DATABASE_URL_ADMIN and APP_URL)");
    process.exit(2);
  }
  createServerResetLink(url, email, { resetMfa: args.includes("--reset-mfa") })
    .then((result) => {
      if ("error" in result) { console.error(result.error); process.exit(1); }
      console.log(`Reset link (single use, valid ${SERVER_RESET_HOURS} h):\n${base}/reset-password/${result.token}`);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
