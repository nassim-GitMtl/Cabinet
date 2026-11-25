// Creates Neon's restricted runtime and sync roles, applies migrations through
// the direct owner connection, and verifies that both pooled connections keep
// row-level security enabled.
//
// Required environment:
//   DATABASE_URL_ADMIN       direct Neon owner URL
//   DATABASE_RUNTIME_PASSWORD  new password for cabinet_app (24+ chars)
//   DATABASE_SYNC_PASSWORD     new password for cabinet_sync (24+ chars)
//
// Add --print-runtime-url only when you are ready to copy the resulting secret
// into the deployment platform's secret store.
import "dotenv/config";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import {
  buildNeonRuntimeUrl,
  buildNeonSyncUrl,
  normalizeDatabaseUrl,
  redactDatabaseUrl,
  RUNTIME_DATABASE_ROLE,
  SYNC_DATABASE_ROLE,
  validateNeonAdminUrl,
} from "../src/server/deployment/database-url";

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  if (value.includes("\0")) throw new Error("Database password cannot contain a null byte");
  return `'${value.replaceAll("'", "''")}'`;
}

async function configureRuntimeRole(adminUrl: string, password: string) {
  const sql = postgres(adminUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    onnotice: () => {},
    connection: { application_name: "cabinet-dentaire-neon-setup" },
  });

  try {
    const [{ currentUser, databaseName }] = await sql<
      { currentUser: string; databaseName: string }[]
    >`select current_user as "currentUser", current_database() as "databaseName"`;
    if (!currentUser || !databaseName) throw new Error("Could not identify the Neon owner connection");
    if (currentUser === RUNTIME_DATABASE_ROLE) {
      throw new Error("Neon setup must run as the project owner, not cabinet_app");
    }

    const existing = await sql<{ exists: boolean }[]>`
      select exists(select 1 from pg_roles where rolname = ${RUNTIME_DATABASE_ROLE}) as exists
    `;
    if (!existing[0]?.exists) {
      await sql.unsafe(
        `CREATE ROLE ${quoteIdentifier(RUNTIME_DATABASE_ROLE)} WITH LOGIN PASSWORD ${quoteLiteral(password)} ` +
          "NOINHERIT",
      );
    } else {
      await sql.unsafe(
        `ALTER ROLE ${quoteIdentifier(RUNTIME_DATABASE_ROLE)} WITH LOGIN PASSWORD ${quoteLiteral(password)} ` +
          "NOINHERIT",
      );
    }

    // A role created in the Neon Console inherits neon_superuser. Remove every
    // inherited group so an existing role cannot silently bypass RLS.
    const memberships = await sql<{ roleName: string }[]>`
      select parent.rolname as "roleName"
        from pg_auth_members membership
        join pg_roles parent on parent.oid = membership.roleid
        join pg_roles member on member.oid = membership.member
       where member.rolname = ${RUNTIME_DATABASE_ROLE}
    `;
    for (const membership of memberships) {
      await sql.unsafe(
        `REVOKE ${quoteIdentifier(membership.roleName)} FROM ${quoteIdentifier(RUNTIME_DATABASE_ROLE)}`,
      );
    }

    // Neon project owners can create roles but are not PostgreSQL superusers,
    // so restricted attributes are verified instead of attempting a privileged
    // ALTER ROLE. Fresh SQL-created roles receive these safe defaults.
    const [attributes] = await sql<
      { superuser: boolean; bypassRls: boolean; createRole: boolean; createDb: boolean; replication: boolean }[]
    >`
      select rolsuper as superuser,
             rolbypassrls as "bypassRls",
             rolcreaterole as "createRole",
             rolcreatedb as "createDb",
             rolreplication as replication
        from pg_roles
       where rolname = ${RUNTIME_DATABASE_ROLE}
    `;
    if (
      !attributes ||
      attributes.superuser ||
      attributes.bypassRls ||
      attributes.createRole ||
      attributes.createDb ||
      attributes.replication
    ) {
      throw new Error("Existing cabinet_app role has unsafe attributes; remove it in Neon and run setup again");
    }

    await sql.unsafe(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)} FROM ${quoteIdentifier(RUNTIME_DATABASE_ROLE)}`,
    );
    await sql.unsafe(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(RUNTIME_DATABASE_ROLE)}`,
    );
    await sql.unsafe(`REVOKE ALL ON SCHEMA public FROM ${quoteIdentifier(RUNTIME_DATABASE_ROLE)}`);
    await sql.unsafe("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  } finally {
    await sql.end();
  }
}

async function configureSyncRole(adminUrl: string, password: string) {
  const sql = postgres(adminUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    onnotice: () => {},
    connection: { application_name: "cabinet-dentaire-neon-sync-setup" },
  });

  try {
    const [{ currentUser, databaseName }] = await sql<
      { currentUser: string; databaseName: string }[]
    >`select current_user as "currentUser", current_database() as "databaseName"`;
    if (!currentUser || !databaseName) throw new Error("Could not identify the Neon owner connection");
    if (currentUser === RUNTIME_DATABASE_ROLE || currentUser === SYNC_DATABASE_ROLE) {
      throw new Error("Neon sync setup must run as the project owner, not an application role");
    }

    const [existing] = await sql<{ exists: boolean }[]>`
      select exists(select 1 from pg_roles where rolname = ${SYNC_DATABASE_ROLE}) as exists
    `;
    if (!existing?.exists) {
      throw new Error("cabinet_sync was not created by the migrations; check that migration 0043 completed");
    }

    // The migration creates this role with safe attributes and NOLOGIN. Only
    // enable login and rotate its secret here; Neon owners are not PostgreSQL
    // superusers, so the attributes are verified below rather than rewritten.
    await sql.unsafe(
      `ALTER ROLE ${quoteIdentifier(SYNC_DATABASE_ROLE)} WITH LOGIN PASSWORD ${quoteLiteral(password)} INHERIT`,
    );

    const memberships = await sql<{ roleName: string }[]>`
      select parent.rolname as "roleName"
        from pg_auth_members membership
        join pg_roles parent on parent.oid = membership.roleid
        join pg_roles member on member.oid = membership.member
       where member.rolname = ${SYNC_DATABASE_ROLE}
    `;
    for (const membership of memberships) {
      if (membership.roleName === RUNTIME_DATABASE_ROLE) continue;
      await sql.unsafe(
        `REVOKE ${quoteIdentifier(membership.roleName)} FROM ${quoteIdentifier(SYNC_DATABASE_ROLE)}`,
      );
    }
    await sql.unsafe(
      `GRANT ${quoteIdentifier(RUNTIME_DATABASE_ROLE)} TO ${quoteIdentifier(SYNC_DATABASE_ROLE)}`,
    );

    const [attributes] = await sql<
      { superuser: boolean; bypassRls: boolean; createRole: boolean; createDb: boolean; replication: boolean }[]
    >`
      select rolsuper as superuser,
             rolbypassrls as "bypassRls",
             rolcreaterole as "createRole",
             rolcreatedb as "createDb",
             rolreplication as replication
        from pg_roles
       where rolname = ${SYNC_DATABASE_ROLE}
    `;
    if (
      !attributes ||
      attributes.superuser ||
      attributes.bypassRls ||
      attributes.createRole ||
      attributes.createDb ||
      attributes.replication
    ) {
      throw new Error("Existing cabinet_sync role has unsafe attributes; remove it and re-run the migrations");
    }

    await sql.unsafe(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)} FROM ${quoteIdentifier(SYNC_DATABASE_ROLE)}`,
    );
    await sql.unsafe(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(SYNC_DATABASE_ROLE)}`,
    );
    await sql.unsafe(`REVOKE ALL ON SCHEMA public FROM ${quoteIdentifier(SYNC_DATABASE_ROLE)}`);
  } finally {
    await sql.end();
  }
}

async function verifyRuntimeConnection(runtimeUrl: string) {
  const sql = postgres(runtimeUrl, {
    max: 1,
    prepare: true,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: () => {},
    connection: { application_name: "cabinet-dentaire-neon-verify" },
  });

  try {
    const [role] = await sql<
      {
        currentUser: string;
        superuser: boolean;
        bypassRls: boolean;
        createRole: boolean;
        createDb: boolean;
        inheritedRoles: number;
        canCreateInPublic: boolean;
      }[]
    >`
      select current_user as "currentUser",
             roles.rolsuper as "superuser",
             roles.rolbypassrls as "bypassRls",
             roles.rolcreaterole as "createRole",
             roles.rolcreatedb as "createDb",
             (select count(*)::integer from pg_auth_members where member = roles.oid) as "inheritedRoles",
             has_schema_privilege(current_user, 'public', 'CREATE') as "canCreateInPublic"
        from pg_roles roles
       where roles.rolname = current_user
    `;
    if (!role || role.currentUser !== RUNTIME_DATABASE_ROLE) {
      throw new Error(`Runtime URL did not connect as ${RUNTIME_DATABASE_ROLE}`);
    }
    if (role.superuser || role.bypassRls || role.createRole || role.createDb || role.inheritedRoles > 0) {
      throw new Error("Runtime role has unsafe PostgreSQL attributes or inherited roles");
    }
    if (role.canCreateInPublic) throw new Error("Runtime role can unexpectedly create objects in public schema");

    // With no tenant context, RLS must expose no organization rows.
    const [visibility] = await sql<{ visibleOrganizations: number }[]>`
      select count(*)::integer as "visibleOrganizations" from public.organizations
    `;
    if (visibility?.visibleOrganizations !== 0) {
      throw new Error("Runtime role can see organizations without a tenant context; RLS verification failed");
    }
  } finally {
    await sql.end();
  }
}

async function verifySyncConnection(syncUrl: string) {
  const sql = postgres(syncUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: () => {},
    connection: { application_name: "cabinet-dentaire-neon-sync-verify" },
  });

  try {
    const [role] = await sql<
      {
        currentUser: string;
        superuser: boolean;
        bypassRls: boolean;
        createRole: boolean;
        createDb: boolean;
        inheritedRoles: string[] | null;
        canCreateInPublic: boolean;
      }[]
    >`
      select current_user as "currentUser",
             roles.rolsuper as "superuser",
             roles.rolbypassrls as "bypassRls",
             roles.rolcreaterole as "createRole",
             roles.rolcreatedb as "createDb",
             (select array_agg(parent.rolname order by parent.rolname)
                from pg_auth_members membership
                join pg_roles parent on parent.oid = membership.roleid
               where membership.member = roles.oid) as "inheritedRoles",
             has_schema_privilege(current_user, 'public', 'CREATE') as "canCreateInPublic"
        from pg_roles roles
       where roles.rolname = current_user
    `;
    if (!role || role.currentUser !== SYNC_DATABASE_ROLE) {
      throw new Error(`Sync URL did not connect as ${SYNC_DATABASE_ROLE}`);
    }
    if (
      role.superuser ||
      role.bypassRls ||
      role.createRole ||
      role.createDb ||
      role.canCreateInPublic ||
      role.inheritedRoles?.length !== 1 ||
      role.inheritedRoles[0] !== RUNTIME_DATABASE_ROLE
    ) {
      throw new Error("Sync role has unsafe PostgreSQL attributes or inherited roles");
    }

    const [visibility] = await sql<{ visibleOrganizations: number; nodeRole: string }[]>`
      select (select count(*)::integer from public.organizations) as "visibleOrganizations",
             app_private.node_role() as "nodeRole"
    `;
    if (visibility?.visibleOrganizations !== 0) {
      throw new Error("Sync role can see organizations without a tenant context; RLS verification failed");
    }
    if (visibility?.nodeRole !== "cloud") {
      throw new Error("Neon database must remain configured as the cloud sync node");
    }
  } finally {
    await sql.end();
  }
}

async function main() {
  const rawAdminUrl = process.env.DATABASE_URL_ADMIN;
  const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD;
  const syncPassword = process.env.DATABASE_SYNC_PASSWORD;
  if (!rawAdminUrl) throw new Error("DATABASE_URL_ADMIN is required (use Neon's direct owner URL)");
  if (!runtimePassword) throw new Error("DATABASE_RUNTIME_PASSWORD is required");
  if (!syncPassword) throw new Error("DATABASE_SYNC_PASSWORD is required");

  validateNeonAdminUrl(rawAdminUrl);
  const adminUrl = normalizeDatabaseUrl(rawAdminUrl);
  const runtimeUrl = buildNeonRuntimeUrl(rawAdminUrl, runtimePassword);
  const syncUrl = buildNeonSyncUrl(rawAdminUrl, syncPassword);

  console.log("1/5 Configuring the restricted cabinet_app role…");
  await configureRuntimeRole(adminUrl, runtimePassword);
  console.log("2/5 Applying database migrations through the direct endpoint…");
  await runMigrations(adminUrl);
  console.log("3/5 Configuring the restricted cabinet_sync role…");
  await configureSyncRole(adminUrl, syncPassword);
  console.log("4/5 Verifying the pooled runtime connection and RLS boundary…");
  await verifyRuntimeConnection(runtimeUrl);
  console.log("5/5 Verifying the pooled sync connection and RLS boundary…");
  await verifySyncConnection(syncUrl);

  console.log("Neon database is ready.");
  console.log(`Verified runtime connection: ${redactDatabaseUrl(runtimeUrl)}`);
  console.log(`Verified sync connection: ${redactDatabaseUrl(syncUrl)}`);
  if (process.argv.includes("--print-runtime-url")) {
    console.log("Store these secrets on the application host:");
    console.log(`DATABASE_URL=${runtimeUrl}`);
    console.log(`SYNC_DATABASE_URL=${syncUrl}`);
  } else {
    console.log("Re-run with --print-runtime-url to display both application database URLs once.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
