import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  admitCoreRuntimeRole,
  type CoreRoleAdmissionFailure,
  type CoreRoleAdmissionProfile,
  type CoreRoleAdmissionResult,
} from "./coreRoleAdmission";

type Fixture = { owner: string; runtime: string };
type NativeCase = {
  name: string;
  setup: string[];
  cleanup: string[];
  reason?: CoreRoleAdmissionFailure;
};

function refuse(): never {
  throw new AppError(ERROR_IDS.DB_READ_FAILED, "Core role fixture failed");
}

function configuration(): Fixture {
  const path = process.argv[2];
  if (path === undefined) refuse();
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || !("owner" in value) || !("runtime" in value))
    refuse();
  if (typeof value.owner !== "string" || typeof value.runtime !== "string") refuse();
  const owner = new URL(value.owner);
  const runtime = new URL(value.runtime);
  for (const url of [owner, runtime])
    if (
      url.protocol !== "postgres:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/core_role_fixture" ||
      url.port === "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      refuse();
  if (
    owner.port !== runtime.port ||
    owner.username !== "core_role_owner" ||
    runtime.username !== "smoke_runtime"
  )
    refuse();
  return { owner: value.owner, runtime: value.runtime };
}

const cases: NativeCase[] = [
  { name: "restricted_smoke_profile", setup: [], cleanup: [] },
  {
    name: "inherit_flag_without_capability",
    setup: ["ALTER ROLE smoke_runtime INHERIT"],
    cleanup: ["ALTER ROLE smoke_runtime NOINHERIT"],
  },
  {
    name: "harmless_inherited_membership",
    setup: ["GRANT harmless TO smoke_runtime WITH INHERIT TRUE, SET FALSE"],
    cleanup: ["REVOKE harmless FROM smoke_runtime"],
  },
  {
    name: "dormant_owner_membership",
    setup: ["GRANT core_role_owner TO smoke_runtime WITH INHERIT FALSE, SET FALSE"],
    cleanup: ["REVOKE core_role_owner FROM smoke_runtime"],
  },
  {
    name: "superuser",
    setup: ["ALTER ROLE smoke_runtime SUPERUSER"],
    cleanup: ["ALTER ROLE smoke_runtime NOSUPERUSER"],
    reason: "role",
  },
  {
    name: "createdb",
    setup: ["ALTER ROLE smoke_runtime CREATEDB"],
    cleanup: ["ALTER ROLE smoke_runtime NOCREATEDB"],
    reason: "role",
  },
  {
    name: "createrole",
    setup: ["ALTER ROLE smoke_runtime CREATEROLE"],
    cleanup: ["ALTER ROLE smoke_runtime NOCREATEROLE"],
    reason: "role",
  },
  {
    name: "replication",
    setup: ["ALTER ROLE smoke_runtime REPLICATION"],
    cleanup: ["ALTER ROLE smoke_runtime NOREPLICATION"],
    reason: "role",
  },
  {
    name: "bypassrls",
    setup: ["ALTER ROLE smoke_runtime BYPASSRLS"],
    cleanup: ["ALTER ROLE smoke_runtime NOBYPASSRLS"],
    reason: "role",
  },
  {
    name: "set_reachable_superuser",
    setup: ["GRANT core_role_owner TO smoke_runtime WITH INHERIT FALSE, SET TRUE"],
    cleanup: ["REVOKE core_role_owner FROM smoke_runtime"],
    reason: "role",
  },
  {
    name: "predefined_role",
    setup: ["GRANT pg_monitor TO smoke_runtime WITH INHERIT TRUE, SET FALSE"],
    cleanup: ["REVOKE pg_monitor FROM smoke_runtime"],
    reason: "capability",
  },
  {
    name: "role_admin_option",
    setup: ["GRANT harmless TO smoke_runtime WITH ADMIN TRUE, INHERIT FALSE, SET FALSE"],
    cleanup: ["REVOKE harmless FROM smoke_runtime"],
    reason: "capability",
  },
  {
    name: "direct_table_owner",
    setup: ["ALTER TABLE public.items OWNER TO smoke_runtime"],
    cleanup: ["ALTER TABLE public.items OWNER TO core_role_owner"],
    reason: "ownership",
  },
  {
    name: "set_only_object_owner",
    setup: [
      "ALTER TABLE public.items OWNER TO object_owner",
      "GRANT object_owner TO smoke_runtime WITH INHERIT FALSE, SET TRUE",
    ],
    cleanup: [
      "REVOKE object_owner FROM smoke_runtime",
      "ALTER TABLE public.items OWNER TO core_role_owner",
    ],
    reason: "ownership",
  },
  {
    name: "mixed_set_inherit_owner",
    setup: [
      "ALTER TABLE public.items OWNER TO object_owner",
      "GRANT object_owner TO bridge WITH INHERIT TRUE, SET FALSE",
      "GRANT bridge TO smoke_runtime WITH INHERIT FALSE, SET TRUE",
    ],
    cleanup: [
      "REVOKE bridge FROM smoke_runtime",
      "REVOKE object_owner FROM bridge",
      "ALTER TABLE public.items OWNER TO core_role_owner",
    ],
    reason: "ownership",
  },
  {
    name: "mixed_set_inherit_predefined",
    setup: [
      "GRANT pg_read_all_data TO bridge WITH INHERIT TRUE, SET FALSE",
      "GRANT bridge TO smoke_runtime WITH INHERIT FALSE, SET TRUE",
    ],
    cleanup: ["REVOKE bridge FROM smoke_runtime", "REVOKE pg_read_all_data FROM bridge"],
    reason: "capability",
  },
  {
    name: "type_owner",
    setup: ["ALTER TYPE public.item_kind OWNER TO smoke_runtime"],
    cleanup: ["ALTER TYPE public.item_kind OWNER TO core_role_owner"],
    reason: "ownership",
  },
  {
    name: "large_object_owner",
    setup: [
      "SELECT pg_catalog.lo_create(60001)",
      "ALTER LARGE OBJECT 60001 OWNER TO smoke_runtime",
    ],
    cleanup: ["SELECT pg_catalog.lo_unlink(60001)"],
    reason: "ownership",
  },
  {
    name: "database_create",
    setup: ["GRANT CREATE ON DATABASE core_role_fixture TO smoke_runtime"],
    cleanup: ["REVOKE CREATE ON DATABASE core_role_fixture FROM smoke_runtime"],
    reason: "create",
  },
  {
    name: "public_schema_create",
    setup: ["GRANT CREATE ON SCHEMA public TO smoke_runtime"],
    cleanup: ["REVOKE CREATE ON SCHEMA public FROM smoke_runtime"],
    reason: "create",
  },
  {
    name: "queue_schema_create",
    setup: ["GRANT CREATE ON SCHEMA pgboss TO smoke_runtime"],
    cleanup: ["REVOKE CREATE ON SCHEMA pgboss FROM smoke_runtime"],
    reason: "create",
  },
  {
    name: "other_schema_create",
    setup: ["GRANT CREATE ON SCHEMA ops TO smoke_runtime"],
    cleanup: ["REVOKE CREATE ON SCHEMA ops FROM smoke_runtime"],
    reason: "create",
  },
  {
    name: "missing_schema_usage",
    setup: ["REVOKE USAGE ON SCHEMA pgboss FROM smoke_runtime"],
    cleanup: ["GRANT USAGE ON SCHEMA pgboss TO smoke_runtime"],
    reason: "schema_usage",
  },
  {
    name: "trigger_control",
    setup: ["GRANT TRIGGER ON TABLE public.items TO smoke_runtime"],
    cleanup: ["REVOKE TRIGGER ON TABLE public.items FROM smoke_runtime"],
    reason: "table_control",
  },
  {
    name: "truncate_control",
    setup: ["GRANT TRUNCATE ON TABLE public.items TO smoke_runtime"],
    cleanup: ["REVOKE TRUNCATE ON TABLE public.items FROM smoke_runtime"],
    reason: "table_control",
  },
  {
    name: "references_control",
    setup: ["GRANT REFERENCES ON TABLE public.items TO smoke_runtime"],
    cleanup: ["REVOKE REFERENCES ON TABLE public.items FROM smoke_runtime"],
    reason: "table_control",
  },
  {
    name: "column_references_control",
    setup: ["GRANT REFERENCES(id) ON TABLE public.items TO smoke_runtime"],
    cleanup: ["REVOKE REFERENCES(id) ON TABLE public.items FROM smoke_runtime"],
    reason: "table_control",
  },
  {
    name: "inherited_trigger_control",
    setup: [
      "GRANT TRIGGER ON TABLE public.items TO harmless",
      "GRANT harmless TO smoke_runtime WITH INHERIT TRUE, SET FALSE",
    ],
    cleanup: [
      "REVOKE harmless FROM smoke_runtime",
      "REVOKE TRIGGER ON TABLE public.items FROM harmless",
    ],
    reason: "table_control",
  },
  {
    name: "sequence_update",
    setup: ["GRANT UPDATE ON SEQUENCE public.items_id_seq TO smoke_runtime"],
    cleanup: ["REVOKE UPDATE ON SEQUENCE public.items_id_seq FROM smoke_runtime"],
    reason: "sequence_control",
  },
  {
    name: "table_grant_option",
    setup: ["GRANT SELECT ON TABLE public.items TO smoke_runtime WITH GRANT OPTION"],
    cleanup: ["REVOKE GRANT OPTION FOR SELECT ON TABLE public.items FROM smoke_runtime"],
    reason: "grant_option",
  },
  {
    name: "column_grant_option",
    setup: ["GRANT SELECT(id) ON TABLE public.items TO smoke_runtime WITH GRANT OPTION"],
    cleanup: ["REVOKE SELECT(id) ON TABLE public.items FROM smoke_runtime"],
    reason: "grant_option",
  },
  {
    name: "routine_grant_option",
    setup: ["GRANT EXECUTE ON FUNCTION public.invoker() TO smoke_runtime WITH GRANT OPTION"],
    cleanup: ["REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.invoker() FROM smoke_runtime"],
    reason: "grant_option",
  },
  {
    name: "schema_grant_option",
    setup: ["GRANT USAGE ON SCHEMA pgboss TO smoke_runtime WITH GRANT OPTION"],
    cleanup: ["REVOKE GRANT OPTION FOR USAGE ON SCHEMA pgboss FROM smoke_runtime"],
    reason: "grant_option",
  },
  {
    name: "default_grant_option",
    setup: [
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO smoke_runtime WITH GRANT OPTION",
    ],
    cleanup: [
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM smoke_runtime",
    ],
    reason: "grant_option",
  },
  {
    name: "parameter_set",
    setup: ["GRANT SET ON PARAMETER log_statement TO smoke_runtime"],
    cleanup: ["REVOKE SET ON PARAMETER log_statement FROM smoke_runtime"],
    reason: "parameter",
  },
  {
    name: "parameter_alter_system",
    setup: ["GRANT ALTER SYSTEM ON PARAMETER log_statement TO smoke_runtime"],
    cleanup: ["REVOKE ALTER SYSTEM ON PARAMETER log_statement FROM smoke_runtime"],
    reason: "parameter",
  },
  {
    name: "target_definer",
    setup: ["ALTER FUNCTION public.invoker() SECURITY DEFINER"],
    cleanup: ["ALTER FUNCTION public.invoker() SECURITY INVOKER"],
    reason: "security_definer",
  },
  {
    name: "outside_schema_definer",
    setup: [
      "CREATE FUNCTION ops.definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
    ],
    cleanup: ["DROP FUNCTION ops.definer()"],
    reason: "security_definer",
  },
  {
    name: "unexecutable_definer",
    setup: [
      "CREATE FUNCTION ops.definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
      "REVOKE EXECUTE ON FUNCTION ops.definer() FROM PUBLIC",
    ],
    cleanup: ["DROP FUNCTION ops.definer()"],
  },
  {
    name: "missing_queue_schema",
    setup: ["ALTER SCHEMA pgboss RENAME TO absent_queue"],
    cleanup: ["ALTER SCHEMA absent_queue RENAME TO pgboss"],
    reason: "catalog",
  },
  {
    name: "unreadable_catalog",
    setup: ["REVOKE SELECT ON TABLE pg_catalog.pg_shdepend FROM PUBLIC"],
    cleanup: ["GRANT SELECT ON TABLE pg_catalog.pg_shdepend TO PUBLIC"],
    reason: "query",
  },
];

function checkOutcome(result: CoreRoleAdmissionResult, expected?: CoreRoleAdmissionFailure): void {
  if (expected === undefined && result.ok) return;
  if (!result.ok && result.reason === expected) return;
  console.warn(
    JSON.stringify({
      event: "core.role.unexpected",
      expected: expected ?? "admitted",
      observed: result.ok ? "admitted" : result.reason,
    }),
  );
  refuse();
}

async function runCase(
  owner: Pool,
  runtime: Pool,
  profile: CoreRoleAdmissionProfile,
  test: NativeCase,
): Promise<void> {
  try {
    for (const statement of test.setup) await owner.query(statement);
    checkOutcome(
      await admitCoreRuntimeRole((config) => runtime.query(config), profile),
      test.reason,
    );
    console.warn(JSON.stringify({ event: "core.role.case", name: test.name, status: "pass" }));
  } finally {
    for (const statement of test.cleanup) await owner.query(statement);
    await owner.query(`
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,pgboss TO smoke_runtime;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,pgboss TO smoke_runtime;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,pgboss TO smoke_runtime;
    `);
  }
}

async function main(): Promise<void> {
  const fixture = configuration();
  const common = {
    max: 1,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1500,
    query_timeout: 2000,
    lock_timeout: 300,
    ssl: false,
  };
  const owner = new Pool({ ...common, connectionString: fixture.owner });
  const runtime = new Pool({ ...common, connectionString: fixture.runtime });
  let idleFailure = false;
  const hasIdleFailure = (): boolean => idleFailure;
  owner.on("error", () => {
    idleFailure = true;
  });
  runtime.on("error", () => {
    idleFailure = true;
  });
  const profile = {
    expectedRole: "smoke_runtime",
    appSchema: "public",
    queueSchema: "pgboss",
    queryTimeoutMs: 2000,
  };
  let currentCase = "setup";
  let passed = 0;
  try {
    await owner.query(`
      CREATE ROLE smoke_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      CREATE ROLE harmless NOLOGIN; CREATE ROLE bridge NOLOGIN; CREATE ROLE object_owner NOLOGIN;
      CREATE SCHEMA pgboss; CREATE SCHEMA ops;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE TABLE public.items(id bigserial PRIMARY KEY, label text);
      CREATE TABLE pgboss.version(id integer);
      CREATE TYPE public.item_kind AS ENUM ('example');
      CREATE FUNCTION public.invoker() RETURNS integer LANGUAGE sql SECURITY INVOKER AS 'SELECT 1';
      GRANT USAGE ON SCHEMA public,pgboss,ops TO smoke_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,pgboss TO smoke_runtime;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,pgboss TO smoke_runtime;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,pgboss TO smoke_runtime;
    `);
    for (const test of cases) {
      currentCase = test.name;
      await runCase(owner, runtime, profile, test);
      passed++;
    }
    currentCase = "switched_identity";
    await owner.query("GRANT harmless TO smoke_runtime WITH INHERIT FALSE, SET TRUE");
    await runtime.query("SET ROLE harmless");
    const switched = await admitCoreRuntimeRole((config) => runtime.query(config), profile);
    await runtime.query("RESET ROLE");
    await owner.query("REVOKE harmless FROM smoke_runtime");
    checkOutcome(switched, "identity");
    passed++;
    currentCase = "owner_credentials";
    const privileged = await admitCoreRuntimeRole((config) => owner.query(config), {
      ...profile,
      expectedRole: "core_role_owner",
    });
    checkOutcome(privileged, "role");
    passed++;
    currentCase = "actual_server_query_bound";
    await owner.query("BEGIN");
    try {
      await owner.query("LOCK TABLE pg_catalog.pg_shdepend IN ACCESS EXCLUSIVE MODE");
      const timed = await admitCoreRuntimeRole((config) => runtime.query(config), profile);
      checkOutcome(timed, "query");
      passed++;
    } finally {
      await owner.query("ROLLBACK");
    }
    currentCase = "restricted_profile_restored";
    const final = await admitCoreRuntimeRole((config) => runtime.query(config), profile);
    checkOutcome(final);
    if (hasIdleFailure()) refuse();
    passed++;
    console.warn(
      JSON.stringify({
        event: "core.role.proof",
        status: "pass",
        passed,
        profile: "core-runtime-dml-v1",
      }),
    );
  } catch {
    console.error(
      JSON.stringify({ event: "core.role.proof", status: "failed", name: currentCase, passed }),
    );
    process.exitCode = 1;
  } finally {
    await Promise.all([runtime.end(), owner.end()]);
  }
}

void main().catch(() => {
  console.error(
    JSON.stringify({ event: "core.role.proof", status: "failed", name: "fixture_lifecycle" }),
  );
  process.exitCode = 1;
});
