/** A single read-only observation on the existing, bounded Core application pool. */
export type CoreRoleQuery = (configuration: CoreRoleQueryConfiguration) => Promise<unknown>;

export interface CoreRoleQueryConfiguration {
  text: string;
  values: string[];
  /** Installed pg honors this field; the owner must also configure real server/checkout bounds. */
  query_timeout: number;
}

export interface CoreRoleAdmissionProfile {
  expectedRole: string;
  /** The v1 policy admits only public/pgboss, validated before any query. */
  appSchema: string;
  queueSchema: string;
  queryTimeoutMs: number;
}

export type CoreRoleAdmissionFailure =
  | "configuration"
  | "query"
  | "evidence"
  | "version"
  | "identity"
  | "catalog"
  | "role"
  | "capability"
  | "ownership"
  | "create"
  | "schema_usage"
  | "table_control"
  | "sequence_control"
  | "grant_option"
  | "security_definer"
  | "parameter";

export type CoreRoleAdmissionResult =
  | { ok: true; profile: "core-runtime-dml-v1" }
  | { ok: false; reason: CoreRoleAdmissionFailure };

type EvidenceCheck = { key: string; reason: CoreRoleAdmissionFailure };
const EVIDENCE_CHECKS: readonly EvidenceCheck[] = [
  { key: "version_ok", reason: "version" },
  { key: "identity_ok", reason: "identity" },
  { key: "catalog_ok", reason: "catalog" },
  { key: "role_ok", reason: "role" },
  { key: "capability_ok", reason: "capability" },
  { key: "ownership_ok", reason: "ownership" },
  { key: "create_ok", reason: "create" },
  { key: "schema_usage_ok", reason: "schema_usage" },
  { key: "table_control_ok", reason: "table_control" },
  { key: "sequence_control_ok", reason: "sequence_control" },
  { key: "grant_option_ok", reason: "grant_option" },
  { key: "security_definer_ok", reason: "security_definer" },
  { key: "parameter_ok", reason: "parameter" },
];

/*
 * PG16 distinguishes SET reachability from inherited privileges. Inspect every
 * SET-reachable actor, then its effective USAGE/ACLs, including mixed paths.
 * Built-in functions, catalogs, types and operators are explicitly qualified so
 * an untrusted search_path cannot replace the admission predicates.
 *
 * This conservative DML profile permits harmless memberships and PUBLIC TEMP,
 * but no object ownership, role administration, privileged predefined roles,
 * explicit parameter ACL power or any executable security definer routine.
 * It does not prove every possible SQL behavior is impossible or prevent later
 * administrator grant drift. Keep isolated DDL-denial and installed checks.
 */
const ADMISSION_SQL = `
WITH login AS MATERIALIZED (
  SELECT r.* FROM pg_catalog.pg_roles AS r
  WHERE r.rolname OPERATOR(pg_catalog.=) SESSION_USER
), actors AS MATERIALIZED (
  SELECT r.* FROM pg_catalog.pg_roles AS r CROSS JOIN login AS l
  WHERE pg_catalog.pg_has_role(l.oid, r.oid, 'SET')
), current_database AS MATERIALIZED (
  SELECT d.* FROM pg_catalog.pg_database AS d
  WHERE d.datname OPERATOR(pg_catalog.=) pg_catalog.current_database()
), target_schemas AS MATERIALIZED (
  SELECT n.* FROM pg_catalog.pg_namespace AS n
  WHERE n.nspname::pg_catalog.text OPERATOR(pg_catalog.=) $2::pg_catalog.text
     OR n.nspname::pg_catalog.text OPERATOR(pg_catalog.=) $3::pg_catalog.text
), target_relations AS MATERIALIZED (
  SELECT c.* FROM pg_catalog.pg_class AS c JOIN target_schemas AS n
  ON c.relnamespace OPERATOR(pg_catalog.=) n.oid
), target_routines AS MATERIALIZED (
  SELECT p.* FROM pg_catalog.pg_proc AS p JOIN target_schemas AS n
  ON p.pronamespace OPERATOR(pg_catalog.=) n.oid
), owners AS MATERIALIZED (
  SELECT d.datdba AS owner FROM current_database AS d
  UNION SELECT n.nspowner FROM target_schemas AS n
  UNION SELECT c.relowner FROM target_relations AS c
  UNION SELECT p.proowner FROM target_routines AS p
  UNION SELECT s.refobjid FROM pg_catalog.pg_shdepend AS s
    CROSS JOIN current_database AS d
    WHERE s.refclassid OPERATOR(pg_catalog.=) 'pg_catalog.pg_authid'::pg_catalog.regclass
      AND s.deptype OPERATOR(pg_catalog.=) 'o'::pg_catalog."char"
      AND (s.dbid OPERATOR(pg_catalog.=) 0::pg_catalog.oid
        OR s.dbid OPERATOR(pg_catalog.=) d.oid)
), object_acls AS MATERIALIZED (
  SELECT c.relacl AS acl FROM pg_catalog.pg_class AS c
  UNION ALL SELECT a.attacl FROM pg_catalog.pg_attribute AS a
  UNION ALL SELECT p.proacl FROM pg_catalog.pg_proc AS p
  UNION ALL SELECT t.typacl FROM pg_catalog.pg_type AS t
  UNION ALL SELECT n.nspacl FROM pg_catalog.pg_namespace AS n
  UNION ALL SELECT d.datacl FROM current_database AS d
  UNION ALL SELECT l.lanacl FROM pg_catalog.pg_language AS l
  UNION ALL SELECT f.fdwacl FROM pg_catalog.pg_foreign_data_wrapper AS f
  UNION ALL SELECT s.srvacl FROM pg_catalog.pg_foreign_server AS s
  UNION ALL SELECT t.spcacl FROM pg_catalog.pg_tablespace AS t
  UNION ALL SELECT l.lomacl FROM pg_catalog.pg_largeobject_metadata AS l
  UNION ALL SELECT d.defaclacl FROM pg_catalog.pg_default_acl AS d
)
SELECT
  (pg_catalog.current_setting('server_version_num')::pg_catalog.int4
      OPERATOR(pg_catalog.>=) 160000
    AND pg_catalog.current_setting('server_version_num')::pg_catalog.int4
      OPERATOR(pg_catalog.<) 170000) AS version_ok,
  (CURRENT_USER OPERATOR(pg_catalog.=) SESSION_USER
    AND CURRENT_USER::pg_catalog.text OPERATOR(pg_catalog.=) $1::pg_catalog.text)
    AS identity_ok,
  ((SELECT pg_catalog.count(*) FROM login) OPERATOR(pg_catalog.=) 1
    AND (SELECT pg_catalog.count(*) FROM current_database) OPERATOR(pg_catalog.=) 1
    AND (SELECT pg_catalog.count(*) FROM target_schemas) OPERATOR(pg_catalog.=) 2
    AND EXISTS (SELECT 1 FROM target_relations AS c JOIN target_schemas AS n
      ON c.relnamespace OPERATOR(pg_catalog.=) n.oid
      WHERE n.nspname::pg_catalog.text OPERATOR(pg_catalog.=) $2::pg_catalog.text)
    AND EXISTS (SELECT 1 FROM target_relations AS c JOIN target_schemas AS n
      ON c.relnamespace OPERATOR(pg_catalog.=) n.oid
      WHERE n.nspname::pg_catalog.text OPERATOR(pg_catalog.=) $3::pg_catalog.text))
    AS catalog_ok,
  NOT EXISTS (SELECT 1 FROM actors AS a WHERE a.rolsuper OR a.rolcreatedb
    OR a.rolcreaterole OR a.rolreplication OR a.rolbypassrls) AS role_ok,
  NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN pg_catalog.pg_roles AS r
    WHERE (pg_catalog.left(r.rolname::pg_catalog.text, 3)
        OPERATOR(pg_catalog.=) 'pg_'::pg_catalog.text
      AND pg_catalog.pg_has_role(a.oid, r.oid, 'USAGE'))
      OR pg_catalog.pg_has_role(a.oid, r.oid, 'MEMBER WITH ADMIN OPTION'))
    AS capability_ok,
  NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN owners AS o
    WHERE pg_catalog.pg_has_role(a.oid, o.owner, 'USAGE')) AS ownership_ok,
  (NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN current_database AS d
      WHERE pg_catalog.has_database_privilege(a.oid, d.oid, 'CREATE'))
    AND NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN pg_catalog.pg_namespace AS n
      WHERE pg_catalog.has_schema_privilege(a.oid, n.oid, 'CREATE'))) AS create_ok,
  NOT EXISTS (SELECT 1 FROM login AS l CROSS JOIN target_schemas AS n
    WHERE NOT pg_catalog.has_schema_privilege(l.oid, n.oid, 'USAGE')) AS schema_usage_ok,
  NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN pg_catalog.pg_class AS c
    WHERE c.relkind OPERATOR(pg_catalog.=) ANY ('{r,p,v,m,f}'::pg_catalog."char"[])
      AND (pg_catalog.has_table_privilege(a.oid, c.oid, 'TRIGGER,TRUNCATE,REFERENCES')
        OR pg_catalog.has_any_column_privilege(a.oid, c.oid, 'REFERENCES')))
    AS table_control_ok,
  NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN pg_catalog.pg_class AS c
    WHERE c.relkind OPERATOR(pg_catalog.=) 'S'::pg_catalog."char"
      AND pg_catalog.has_sequence_privilege(a.oid, c.oid, 'UPDATE')) AS sequence_control_ok,
  NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN object_acls AS o
    CROSS JOIN LATERAL pg_catalog.aclexplode(o.acl) AS p
    WHERE p.is_grantable AND CASE WHEN p.grantee OPERATOR(pg_catalog.=) 0::pg_catalog.oid
      THEN true ELSE pg_catalog.pg_has_role(a.oid, p.grantee, 'USAGE') END)
    AS grant_option_ok,
  NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN pg_catalog.pg_proc AS p
    WHERE p.prosecdef AND pg_catalog.has_function_privilege(a.oid, p.oid, 'EXECUTE'))
    AS security_definer_ok,
  NOT EXISTS (SELECT 1 FROM actors AS a CROSS JOIN pg_catalog.pg_parameter_acl AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.paracl) AS g
    WHERE CASE WHEN g.grantee OPERATOR(pg_catalog.=) 0::pg_catalog.oid THEN true
      ELSE pg_catalog.pg_has_role(a.oid, g.grantee, 'USAGE') END) AS parameter_ok
`;

function validProfile(profile: CoreRoleAdmissionProfile): boolean {
  return (
    profile.expectedRole.length > 0 &&
    !profile.expectedRole.includes("\0") &&
    new TextEncoder().encode(profile.expectedRole).byteLength <= 63 &&
    profile.appSchema === "public" &&
    profile.queueSchema === "pgboss" &&
    Number.isSafeInteger(profile.queryTimeoutMs) &&
    profile.queryTimeoutMs > 0 &&
    profile.queryTimeoutMs <= 2_147_483_647
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evaluate(result: unknown): CoreRoleAdmissionResult {
  if (!isRecord(result) || !Array.isArray(result.rows) || result.rows.length !== 1)
    return { ok: false, reason: "evidence" };
  const row: unknown = result.rows[0];
  if (!isRecord(row) || Object.keys(row).length !== EVIDENCE_CHECKS.length)
    return { ok: false, reason: "evidence" };
  for (const check of EVIDENCE_CHECKS)
    if (!Object.hasOwn(row, check.key) || typeof row[check.key] !== "boolean")
      return { ok: false, reason: "evidence" };
  for (const check of EVIDENCE_CHECKS)
    if (row[check.key] !== true) return { ok: false, reason: check.reason };
  return { ok: true, profile: "core-runtime-dml-v1" };
}

/**
 * No pool, transaction, DDL, grant, fallback or retry is created here. The owner
 * must retain the actual returned promise through startup/drain and supply a
 * pool with finite checkout/connect/server bounds; query_timeout is not proof
 * of server cancellation. Only fixed finite outcomes leave this boundary.
 */
export async function admitCoreRuntimeRole(
  query: CoreRoleQuery,
  profile: CoreRoleAdmissionProfile,
): Promise<CoreRoleAdmissionResult> {
  if (!validProfile(profile)) return { ok: false, reason: "configuration" };
  try {
    return evaluate(
      await query({
        text: ADMISSION_SQL,
        values: [profile.expectedRole, profile.appSchema, profile.queueSchema],
        query_timeout: profile.queryTimeoutMs,
      }),
    );
  } catch {
    return { ok: false, reason: "query" };
  }
}
