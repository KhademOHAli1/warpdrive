import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitCoreRuntimeRole,
  type CoreRoleAdmissionFailure,
  type CoreRoleAdmissionProfile,
  type CoreRoleQuery,
} from "./coreRoleAdmission";

const profile: CoreRoleAdmissionProfile = {
  expectedRole: "smoke_runtime",
  appSchema: "public",
  queueSchema: "pgboss",
  queryTimeoutMs: 3000,
};

function evidence(): Record<string, unknown> {
  return {
    version_ok: true,
    identity_ok: true,
    catalog_ok: true,
    role_ok: true,
    capability_ok: true,
    ownership_ok: true,
    create_ok: true,
    schema_usage_ok: true,
    table_control_ok: true,
    sequence_control_ok: true,
    grant_option_ok: true,
    security_definer_ok: true,
    parameter_ok: true,
  };
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<Value>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("Core runtime role admission evidence boundary", () => {
  it("admits only the named complete strict profile and never returns catalog or role details", async () => {
    const query = vi.fn<CoreRoleQuery>(() => Promise.resolve({ rows: [evidence()] }));
    expect(await admitCoreRuntimeRole(query, profile)).toEqual({
      ok: true,
      profile: "core-runtime-dml-v1",
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  const denied: { key: string; reason: CoreRoleAdmissionFailure }[] = [
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
  it.each(denied)("fails closed for $reason evidence", async ({ key, reason }) => {
    const row = evidence();
    row[key] = false;
    const query = vi.fn<CoreRoleQuery>(() => Promise.resolve({ rows: [row] }));
    expect(await admitCoreRuntimeRole(query, profile)).toEqual({ ok: false, reason });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, "false", "true", 0, 1, {}, []])(
    "rejects non-boolean catalog evidence %j without coercion",
    async (value) => {
      const row = evidence();
      row.ownership_ok = value;
      const query = vi.fn<CoreRoleQuery>(() => Promise.resolve({ rows: [row] }));
      expect(await admitCoreRuntimeRole(query, profile)).toEqual({ ok: false, reason: "evidence" });
    },
  );

  it("rejects missing, extra and inherited evidence instead of accepting a vacuous catalog result", async () => {
    const missing = evidence();
    delete missing.security_definer_ok;
    const extra = { ...evidence(), privateCatalogDetail: "private" };
    const inherited: unknown = Object.create(evidence());
    for (const row of [missing, extra, inherited]) {
      const query = vi.fn<CoreRoleQuery>(() => Promise.resolve({ rows: [row] }));
      expect(await admitCoreRuntimeRole(query, profile)).toEqual({ ok: false, reason: "evidence" });
    }
  });

  it.each([
    undefined,
    null,
    {},
    [],
    { rows: null },
    { rows: [] },
    { rows: [{}, {}] },
    { rows: [null] },
  ])("rejects malformed or ambiguous query result %j", async (result) => {
    const query = vi.fn<CoreRoleQuery>(() => Promise.resolve(result));
    expect(await admitCoreRuntimeRole(query, profile)).toEqual({ ok: false, reason: "evidence" });
  });

  it("returns only finite sanitized facts on a query rejection and makes no fallback attempt", async () => {
    const query = vi.fn<CoreRoleQuery>(() =>
      Promise.reject(new Error("postgres://owner:private@host/db SELECT private_catalog")),
    );
    const result = await admitCoreRuntimeRole(query, profile);
    expect(result).toEqual({ ok: false, reason: "query" });
    expect(JSON.stringify(result)).not.toMatch(/owner|private|SELECT|postgres:/u);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("retains the actual injected query promise instead of treating a timer as cancellation", async () => {
    vi.useFakeTimers();
    const operation = deferred<unknown>();
    const query = vi.fn<CoreRoleQuery>(() => operation.promise);
    let settled = false;
    const result = admitCoreRuntimeRole(query, profile).then((outcome) => {
      settled = true;
      return outcome;
    });
    await vi.advanceTimersByTimeAsync(6000);
    expect(settled).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    operation.reject(new Error("private late transport failure"));
    expect(await result).toEqual({ ok: false, reason: "query" });
  });
});

describe("Core role admission query and profile contract", () => {
  it("uses exactly one parameterized read-only statement with an explicit driver bound", async () => {
    const expectedRole = "runtime'; SELECT private; --";
    const query = vi.fn<CoreRoleQuery>(() => Promise.resolve({ rows: [evidence()] }));
    await admitCoreRuntimeRole(query, { ...profile, expectedRole });
    const configuration = query.mock.calls[0]?.[0];
    expect(configuration).toMatchObject({
      values: [expectedRole, "public", "pgboss"],
      query_timeout: 3000,
    });
    expect(configuration?.text.trim()).toMatch(/^WITH login AS MATERIALIZED/u);
    expect(configuration?.text).not.toContain(expectedRole);
    expect(configuration?.text).not.toContain(";");
    expect(configuration?.text).not.toMatch(
      /\b(?:CREATE|ALTER|DROP|REINDEX|GRANT|REVOKE)\s+(?:ROLE|TABLE|SCHEMA|FUNCTION|DATABASE)\b/u,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("checks SET-reachable actors and inherited owner/capability paths without banning INHERIT", async () => {
    const query = vi.fn<CoreRoleQuery>(() => Promise.resolve({ rows: [evidence()] }));
    await admitCoreRuntimeRole(query, profile);
    const sql = query.mock.calls[0]?.[0].text;
    expect(sql).toContain("pg_catalog.pg_has_role(l.oid, r.oid, 'SET')");
    expect(sql).toContain("pg_catalog.pg_has_role(a.oid, o.owner, 'USAGE')");
    expect(sql).toContain("'MEMBER WITH ADMIN OPTION'");
    expect(sql).not.toContain("rolinherit");
    expect(sql).toContain("CURRENT_USER OPERATOR(pg_catalog.=) SESSION_USER");
  });

  it("covers column and uncommon object grant options, explicit parameter ACLs and routine definer power", async () => {
    const query = vi.fn<CoreRoleQuery>(() => Promise.resolve({ rows: [evidence()] }));
    await admitCoreRuntimeRole(query, profile);
    const sql = query.mock.calls[0]?.[0].text;
    for (const catalog of [
      "pg_attribute",
      "pg_type",
      "pg_foreign_data_wrapper",
      "pg_foreign_server",
      "pg_tablespace",
      "pg_language",
      "pg_largeobject_metadata",
      "pg_default_acl",
      "pg_shdepend",
      "pg_parameter_acl",
    ])
      expect(sql).toContain(`pg_catalog.${catalog}`);
    expect(sql).toContain("p.is_grantable");
    expect(sql).toContain("'TRIGGER,TRUNCATE,REFERENCES'");
    expect(sql).toContain("pg_catalog.has_any_column_privilege");
    expect(sql).toContain("p.prosecdef AND pg_catalog.has_function_privilege");
    expect(sql).toContain(
      "FROM actors AS a CROSS JOIN pg_catalog.pg_proc AS p\n    WHERE p.prosecdef",
    );
    expect(sql).not.toContain("pg_catalog.has_parameter_privilege");
  });

  const invalid: Partial<CoreRoleAdmissionProfile>[] = [
    { expectedRole: "" },
    { expectedRole: "runtime\0owner" },
    { expectedRole: "a".repeat(64) },
    { expectedRole: "ü".repeat(32) },
    { appSchema: "other" },
    { queueSchema: "other" },
    { queryTimeoutMs: 0 },
    { queryTimeoutMs: -1 },
    { queryTimeoutMs: 0.5 },
    { queryTimeoutMs: Number.NaN },
    { queryTimeoutMs: Number.POSITIVE_INFINITY },
    { queryTimeoutMs: 2_147_483_648 },
  ];
  it.each(invalid)("rejects invalid profile %j before touching the pool", async (override) => {
    const query = vi.fn<CoreRoleQuery>(() => Promise.resolve({ rows: [evidence()] }));
    expect(await admitCoreRuntimeRole(query, { ...profile, ...override })).toEqual({
      ok: false,
      reason: "configuration",
    });
    expect(query).not.toHaveBeenCalled();
  });
});
