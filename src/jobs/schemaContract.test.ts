import { PgBoss, type QueueResult, type SchemaDriftReport } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QUEUE_CATALOG_ENUM,
  QUEUE_CATALOG_FUNCTIONS,
  QUEUE_CATALOG_TABLES,
  QUEUE_NAMES,
  QUEUE_OPTIONS,
} from "./queueManifest";
import {
  assertQueueSchema,
  installRuntimeQueueAssertions,
  migrateQueueSchema,
  type QueueCatalogEvidence,
  queueCatalogCoverageMatches,
  queueMigrationDriftIsRecoverable,
  runtimeQueueOptions,
  startAdmittedRuntimeBoss,
  waitForQueueBuilds,
} from "./schemaContract";

const queues = (): QueueResult[] =>
  QUEUE_NAMES.map((name) => ({
    name,
    ...QUEUE_OPTIONS,
    table: "job_common",
    retryDelayMax: null,
    heartbeatSeconds: null,
    deadLetter: null,
  })) as unknown as QueueResult[];

const drift = (): SchemaDriftReport => ({
  ok: true,
  missingTables: [],
  missing: [],
  building: [],
  invalid: [],
  extraIndexes: [],
  mismatched: [],
  missingFunctions: [],
  mismatchedFunctions: [],
  columnDrift: [],
  constraintDrift: [],
  enumDrift: null,
});

function reader() {
  return {
    schemaVersion: vi.fn().mockResolvedValue(46),
    getBamStatus: vi.fn().mockResolvedValue([]),
    detectSchemaDrift: vi.fn().mockResolvedValue(drift()),
    getQueues: vi.fn().mockResolvedValue(queues()),
    getQueue: vi.fn().mockResolvedValue(queues()[0]),
    assertCatalogCoverage: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("queue runtime admission", () => {
  it("requires all four independent schema/BAM/drift/manifest proofs", async () => {
    const probe = reader();
    await expect(assertQueueSchema(probe, AbortSignal.timeout(5_000))).resolves.toBeUndefined();
    expect(probe.getQueues).toHaveBeenCalledExactlyOnceWith([...QUEUE_NAMES]);
  });

  it.each([null, 45, 47])("rejects schema version %s", async (version) => {
    const probe = reader();
    probe.schemaVersion.mockResolvedValue(version);
    await expect(assertQueueSchema(probe, AbortSignal.timeout(5_000))).rejects.toThrow(
      "Background queue schema admission failed",
    );
    expect(probe.getBamStatus).not.toHaveBeenCalled();
  });

  it.each(["pending", "in_progress", "failed"])(
    "rejects %s BAM despite schema46",
    async (status) => {
      const probe = reader();
      probe.getBamStatus.mockResolvedValue([{ status, count: 1 }]);
      await expect(assertQueueSchema(probe, AbortSignal.timeout(5_000))).rejects.toThrow();
      expect(probe.detectSchemaDrift).not.toHaveBeenCalled();
    },
  );

  it("rejects indexes still building even when drift.ok is true", async () => {
    const probe = reader();
    probe.detectSchemaDrift.mockResolvedValue({
      ...drift(),
      building: [{ name: "job_i14", table: "job_common" }],
    });
    await expect(assertQueueSchema(probe, AbortSignal.timeout(5_000))).rejects.toThrow();
  });

  it("rejects drift, missing queues, and option drift", async () => {
    const probe = reader();
    probe.detectSchemaDrift.mockResolvedValue({ ...drift(), ok: false });
    await expect(assertQueueSchema(probe, AbortSignal.timeout(5_000))).rejects.toThrow();
    probe.detectSchemaDrift.mockResolvedValue(drift());
    probe.getQueues.mockResolvedValue(queues().slice(1));
    await expect(assertQueueSchema(probe, AbortSignal.timeout(5_000))).rejects.toThrow();
    const changed = queues();
    changed[0] = { ...changed[0]!, retryLimit: 8 };
    probe.getQueues.mockResolvedValue(changed);
    await expect(assertQueueSchema(probe, AbortSignal.timeout(5_000))).rejects.toThrow();
  });

  it("only admits recorded index-build drift for an explicit owner migration rerun", () => {
    expect(
      queueMigrationDriftIsRecoverable({
        ...drift(),
        ok: false,
        invalid: [{ name: "job_i14", table: "job_common", building: true }],
      }),
    ).toBe(true);
    expect(
      queueMigrationDriftIsRecoverable({
        ...drift(),
        ok: false,
        invalid: [{ name: "job_i14", table: "job_common", building: false }],
      }),
    ).toBe(false);
    expect(
      queueMigrationDriftIsRecoverable({
        ...drift(),
        ok: false,
        missingTables: ["job"],
      }),
    ).toBe(false);
    expect(
      queueMigrationDriftIsRecoverable({
        ...drift(),
        ok: false,
        columnDrift: [{ table: "job" } as SchemaDriftReport["columnDrift"][number]],
      }),
    ).toBe(false);
  });

  it("bounds a public API that never resolves when admission is cancelled", async () => {
    const probe = reader();
    probe.getBamStatus.mockImplementation(() => new Promise(() => undefined));
    const abort = new AbortController();
    const result = assertQueueSchema(probe, abort.signal);
    await vi.waitFor(() => expect(probe.getBamStatus).toHaveBeenCalledOnce());
    abort.abort();
    await expect(result).rejects.toThrow("Queue operation timed out");
    expect(probe.detectSchemaDrift).not.toHaveBeenCalled();
  });

  it("disables DDL maintenance while preserving Worker scheduler and supervisor", () => {
    for (const role of ["app", "worker"] as const) {
      expect(runtimeQueueOptions(role)).toMatchObject({
        migrate: false,
        createSchema: false,
        reindex: false,
        persistQueueStats: false,
        query_timeout: 5_000,
        statement_timeout: 5_000,
        lock_timeout: 2_000,
        idle_in_transaction_session_timeout: 5_000,
        keepAlive: true,
        schedule: role === "worker",
        supervise: role === "worker",
      });
    }
  });

  it("runtime createQueue only reads declared pre-existing standard queues", async () => {
    const boss = new PgBoss("postgres://fixture:synthetic-secret@127.0.0.1/unused");
    const read = vi.spyOn(boss, "getQueue").mockResolvedValue(queues()[0]!);
    const original = vi.spyOn(boss, "createQueue");
    installRuntimeQueueAssertions(boss);
    await expect(boss.createQueue("email.sync")).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledExactlyOnceWith("email.sync");
    expect(original).not.toHaveBeenCalled();
    await expect(boss.createQueue("undeclared")).rejects.toThrow();
    await expect(boss.createQueue("email.sync", { partition: true })).rejects.toThrow();
    read.mockResolvedValue(null);
    await expect(boss.createQueue("email.sync")).rejects.toThrow();
    expect(original).not.toHaveBeenCalled();
  });

  it("stops an unpublished runtime on admission failure before start", async () => {
    const boss = new PgBoss("postgres://fixture:synthetic-secret@127.0.0.1/unused");
    const start = vi.spyOn(boss, "start");
    const stop = vi.spyOn(boss, "stop").mockResolvedValue(undefined);
    await expect(
      startAdmittedRuntimeBoss(boss, () => Promise.reject(new Error("rejected"))),
    ).rejects.toThrow("rejected");
    expect(start).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledExactlyOnceWith({ graceful: false, timeout: 1_000 });
  });
});

describe("explicit queue migration completion", () => {
  it("waits through pending and in-progress BAM before returning", async () => {
    const probe = reader();
    probe.getBamStatus
      .mockResolvedValueOnce([{ status: "pending", count: 1 }])
      .mockResolvedValueOnce([{ status: "in_progress", count: 1 }])
      .mockResolvedValueOnce([{ status: "completed", count: 1 }]);
    await waitForQueueBuilds(probe, AbortSignal.timeout(5_000));
    expect(probe.getBamStatus).toHaveBeenCalledTimes(3);
  });

  it("never admits a failed BAM command", async () => {
    const probe = reader();
    probe.getBamStatus.mockResolvedValue([{ status: "failed", count: 1 }]);
    await expect(waitForQueueBuilds(probe, AbortSignal.timeout(20))).rejects.toThrow();
  });

  it("bootstraps only the finite queues and stops after all final checks", async () => {
    vi.spyOn(PgBoss.prototype, "start").mockImplementation(function (this: PgBoss) {
      return Promise.resolve(this);
    });
    const create = vi.spyOn(PgBoss.prototype, "createQueue").mockResolvedValue(undefined);
    vi.spyOn(PgBoss.prototype, "schemaVersion").mockResolvedValue(46);
    vi.spyOn(PgBoss.prototype, "getBamStatus").mockResolvedValue([]);
    vi.spyOn(PgBoss.prototype, "detectSchemaDrift").mockResolvedValue(drift());
    vi.spyOn(PgBoss.prototype, "getQueues").mockResolvedValue(queues());
    const stop = vi.spyOn(PgBoss.prototype, "stop").mockResolvedValue(undefined);
    const verify = vi.fn().mockResolvedValue(undefined);

    await migrateQueueSchema(
      "postgres://fixture:synthetic-secret@127.0.0.1/unused",
      AbortSignal.timeout(5_000),
      verify,
    );

    expect(create.mock.calls).toEqual(QUEUE_NAMES.map((name) => [name, QUEUE_OPTIONS]));
    expect(stop).toHaveBeenCalledExactlyOnceWith({ graceful: false, timeout: 1_000 });
    expect(verify).toHaveBeenCalledOnce();
  });
});

function catalogEvidence(): QueueCatalogEvidence {
  return {
    columns: Object.entries(QUEUE_CATALOG_TABLES).flatMap(([table, expected]) =>
      expected.columns.map((column) => ({ table, column })),
    ),
    constraints: Object.entries(QUEUE_CATALOG_TABLES).map(([table, expected]) => ({
      table,
      count: expected.constraints,
    })),
    functions: Object.entries(QUEUE_CATALOG_FUNCTIONS).map(([name, expected]) => ({
      name,
      ...expected,
      securityDefiner: false,
      definition: "AS $function$ SELECT fixture; $function$",
    })),
    enumLabels: QUEUE_CATALOG_ENUM.map((label) => ({ label })),
  };
}

describe("strict readable catalog coverage", () => {
  it("requires all expected schema46 tables, columns, constraints, functions and enum labels", () => {
    expect(queueCatalogCoverageMatches(catalogEvidence())).toBe(true);
  });

  it.each(["columns", "constraints", "functions", "enumLabels"] as const)(
    "rejects zero-row %s evidence",
    (dimension) => {
      expect(queueCatalogCoverageMatches({ ...catalogEvidence(), [dimension]: [] })).toBe(false);
    },
  );

  it("rejects missing dimensions for one managed table and missing/overloaded functions", () => {
    const evidence = catalogEvidence();
    expect(
      queueCatalogCoverageMatches({
        ...evidence,
        columns: evidence.columns.filter((column) => column.table !== "queue"),
      }),
    ).toBe(false);
    expect(
      queueCatalogCoverageMatches({
        ...evidence,
        constraints: evidence.constraints.filter((constraint) => constraint.table !== "version"),
      }),
    ).toBe(false);
    expect(
      queueCatalogCoverageMatches({
        ...evidence,
        functions: [...evidence.functions, evidence.functions[0]!],
      }),
    ).toBe(false);
  });

  it("rejects SQL-standard or empty function bodies which the vendor body diff skips", () => {
    for (const definition of ["RETURN now()", "BEGIN ATOMIC SELECT now(); END", "AS $$   $$"]) {
      const evidence = catalogEvidence();
      evidence.functions[0] = { ...evidence.functions[0]!, definition };
      expect(queueCatalogCoverageMatches(evidence)).toBe(false);
    }
  });

  it("rejects changed signatures or function execution privilege", () => {
    const evidence = catalogEvidence();
    evidence.functions[0] = { ...evidence.functions[0]!, securityDefiner: true };
    expect(queueCatalogCoverageMatches(evidence)).toBe(false);
    evidence.functions[0] = {
      ...evidence.functions[0],
      securityDefiner: false,
      arguments: "integer",
    };
    expect(queueCatalogCoverageMatches(evidence)).toBe(false);
  });

  it("rejects catalog unavailability even if a drift result says ok", async () => {
    const probe = reader();
    probe.assertCatalogCoverage.mockRejectedValue(new Error("catalog unavailable"));
    await expect(assertQueueSchema(probe, AbortSignal.timeout(5_000))).rejects.toThrow(
      "catalog unavailable",
    );
    expect(probe.getQueues).not.toHaveBeenCalled();
  });
});
