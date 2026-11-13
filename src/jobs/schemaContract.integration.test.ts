import { randomUUID } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import { admitCoreRuntimeRole } from "@/db/coreRoleAdmission";
import { applyCoreMigrations } from "@/db/migrate";
import { makeTestDb } from "@/test/db";
import { startAppBoss } from "./appInstrumentation";
import { QUEUE_NAMES } from "./queueManifest";
import {
  assertRuntimeQueueSchema,
  inspectQueueMigrationSource,
  migrateQueueSchema,
  runtimeQueueOptions,
  startAdmittedRuntimeBoss,
  withCoreMigrationLock,
} from "./schemaContract";

async function fingerprint(pool: Pool): Promise<string> {
  const result = await pool.query<{ fingerprint: string }>(`
    SELECT md5(string_agg(definition,E'\n' ORDER BY definition)) AS fingerprint FROM (
      SELECT concat_ws(':','relation',c.relname,c.relkind,c.relowner,c.relacl) AS definition
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss'
      UNION ALL SELECT concat_ws(':','index',indexname,indexdef) FROM pg_indexes WHERE schemaname='pgboss'
      UNION ALL SELECT concat_ws(':','function',p.oid::regprocedure,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.prosecdef)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pgboss'
      UNION ALL SELECT concat_ws(':','column',table_name,column_name,data_type,is_nullable,column_default)
        FROM information_schema.columns WHERE table_schema='pgboss'
      UNION ALL SELECT concat_ws(':','constraint',c.conrelid::regclass,c.conname,pg_get_constraintdef(c.oid))
        FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='pgboss'
      UNION ALL SELECT concat_ws(':','schema',nspname,nspowner,nspacl) FROM pg_namespace WHERE nspname='pgboss'
    ) shape
  `);
  return result.rows[0]!.fingerprint;
}

describe("explicit queue migration and non-owner runtime", () => {
  it("prepares once, admits runtime without DDL, preserves producer-first delivery and rejects missing queues", async () => {
    const h = await makeTestDb();
    const role = `queue_runtime_${randomUUID().replaceAll("-", "")}`;
    const runtimeUrl = new URL(h.url);
    runtimeUrl.username = role;
    runtimeUrl.password = "synthetic-queue-runtime-password";
    const runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });
    const app = new PgBoss({
      connectionString: runtimeUrl.toString(),
      ...runtimeQueueOptions("app"),
    });
    const worker = new PgBoss({
      connectionString: runtimeUrl.toString(),
      ...runtimeQueueOptions("worker"),
    });
    const errors: unknown[] = [];
    app.on("error", (error) => errors.push(error));
    worker.on("error", (error) => errors.push(error));
    let createdRole = false;
    try {
      expect(await applyCoreMigrations(h.db, h.url)).toEqual({
        ok: true,
        value: { applied: true },
      });
      expect(await applyCoreMigrations(h.db, h.url)).toEqual({
        ok: true,
        value: { applied: true },
      });
      const count = await h.pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM pgboss.queue",
      );
      expect(count.rows[0]?.count).toBe(QUEUE_NAMES.length);
      expect((await h.pool.query("SELECT * FROM pgboss.schedule")).rows).toEqual([]);
      expect((await h.pool.query("SELECT * FROM pgboss.job")).rows).toEqual([]);

      await h.pool.query(
        `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD 'synthetic-queue-runtime-password'`,
      );
      createdRole = true;
      const database = (await h.pool.query<{ name: string }>("SELECT current_database() AS name"))
        .rows[0]!.name;
      // This is an isolated disposable database, not the shared template or any installed DB.
      await h.pool.query(`REVOKE CREATE,TEMPORARY ON DATABASE "${database}" FROM PUBLIC`);
      await h.pool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      await h.pool.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
      await h.pool.query(`GRANT USAGE ON SCHEMA pgboss TO "${role}"`);
      await h.pool.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss TO "${role}"`,
      );
      await h.pool.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO "${role}"`);
      await h.pool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO "${role}"`);
      await h.pool.query(`CREATE FUNCTION public.reject_queue_runtime_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN IF current_user='${role}' THEN RAISE EXCEPTION 'runtime DDL rejected' USING ERRCODE='42501'; END IF; END $$`);
      await h.pool.query(
        "CREATE EVENT TRIGGER reject_queue_runtime_ddl ON ddl_command_start EXECUTE FUNCTION public.reject_queue_runtime_ddl()",
      );

      const privilege = await runtimePool.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,
        has_schema_privilege(current_user,'pgboss','CREATE') AS schema_create,
        has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
        pg_has_role(current_user,n.nspowner,'MEMBER') AS owner_member
        FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname=current_user AND n.nspname='pgboss'`);
      expect(privilege.rows).toEqual([
        {
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          schema_create: false,
          database_create: false,
          owner_member: false,
        },
      ]);
      for (const statement of [
        "CREATE TABLE pgboss.runtime_probe(id integer)",
        "ALTER TABLE pgboss.queue ADD COLUMN runtime_probe integer",
        "DROP TABLE pgboss.queue",
        "REINDEX TABLE pgboss.queue",
      ])
        await expect(runtimePool.query(statement)).rejects.toMatchObject({ code: "42501" });
      const roleProfile = {
        expectedRole: role,
        appSchema: "public",
        queueSchema: "pgboss",
        queryTimeoutMs: 5_000,
      };
      const admitRole = () =>
        admitCoreRuntimeRole((configuration) => runtimePool.query(configuration), roleProfile);
      expect(await admitRole()).toEqual({ ok: true, profile: "core-runtime-dml-v1" });
      await h.pool.query(`GRANT SELECT ON pgboss.queue TO "${role}" WITH GRANT OPTION`);
      try {
        expect(await admitRole()).toEqual({ ok: false, reason: "grant_option" });
      } finally {
        await h.pool.query(`REVOKE GRANT OPTION FOR SELECT ON pgboss.queue FROM "${role}"`);
      }
      expect(await admitRole()).toEqual({ ok: true, profile: "core-runtime-dml-v1" });
      const before = await fingerprint(h.pool);
      const published = vi.fn();
      await startAppBoss({
        createBoss: () => app,
        admit: () => assertRuntimeQueueSchema(runtimeUrl.toString()),
        setBoss: published,
      });
      expect(published).toHaveBeenCalledExactlyOnceWith(app);
      expect(app.getWipData({ includeInternal: true })).toEqual([]);

      const imports = ["import.prepare", "import.validate", "import.commit", "import.undo"];
      for (const name of imports) {
        await app.createQueue(name); // Assertion only: must not invoke create_queue in runtime.
        expect(
          await app.send(
            name,
            { batchId: "synthetic-batch" },
            { retryLimit: 3, expireInSeconds: 60 },
          ),
        ).toBeTypeOf("string");
      }
      expect(
        (await h.pool.query("SELECT state FROM pgboss.job WHERE name LIKE 'import.%'")).rows,
      ).toEqual(imports.map(() => ({ state: "created" })));
      await startAdmittedRuntimeBoss(worker, () => assertRuntimeQueueSchema(runtimeUrl.toString()));
      for (const name of imports) {
        await worker.work(name, { pollingIntervalSeconds: 0.5 }, (jobs) => {
          for (const job of jobs) expect(job.data).toEqual({ batchId: "synthetic-batch" });
          return Promise.resolve();
        });
      }
      await vi.waitFor(
        async () => {
          const jobs = await h.pool.query(
            "SELECT state FROM pgboss.job WHERE name LIKE 'import.%'",
          );
          expect(jobs.rows).toHaveLength(4);
          expect(jobs.rows.every((job) => job.state === "completed")).toBe(true);
        },
        { timeout: 10_000, interval: 100 },
      );
      expect(errors).toEqual([]);
      expect(await fingerprint(h.pool)).toBe(before);
      await worker.stop({ graceful: true, timeout: 1_000 });
      await app.stop({ graceful: true, timeout: 1_000 });

      await h.pool.query("DELETE FROM pgboss.queue WHERE name='email.sync'");
      const failed = new PgBoss({
        connectionString: runtimeUrl.toString(),
        ...runtimeQueueOptions("worker"),
      });
      const start = vi.spyOn(failed, "start");
      await expect(
        startAdmittedRuntimeBoss(failed, () => assertRuntimeQueueSchema(runtimeUrl.toString())),
      ).rejects.toThrow("Background queue schema admission failed");
      expect(start).not.toHaveBeenCalled();
      expect(
        (await h.pool.query("SELECT name FROM pgboss.queue WHERE name='email.sync'")).rows,
      ).toEqual([]);
      await migrateQueueSchema(h.url, AbortSignal.timeout(30_000));
      await assertRuntimeQueueSchema(runtimeUrl.toString());
    } finally {
      await worker.stop({ graceful: false, timeout: 1_000 });
      await app.stop({ graceful: false, timeout: 1_000 });
      await runtimePool.end();
      if (createdRole) {
        await h.pool.query(`DROP OWNED BY "${role}"`);
        await h.pool.query(`DROP ROLE "${role}"`);
      }
      await h.close();
    }
  });

  it("rejects future/partial source before applying application migration receipts", async () => {
    const h = await makeTestDb();
    try {
      const before = await h.pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id");
      await h.pool.query("CREATE SCHEMA pgboss");
      await h.pool.query("CREATE TABLE pgboss.unrecognized(id integer)");
      expect((await applyCoreMigrations(h.db, h.url)).ok).toBe(false);
      await expect(
        inspectQueueMigrationSource(h.url, AbortSignal.timeout(5_000)),
      ).rejects.toThrow();
      expect(
        (await h.pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows,
      ).toEqual(before.rows);
      await h.pool.query("DROP SCHEMA pgboss CASCADE");
      await migrateQueueSchema(h.url, AbortSignal.timeout(30_000));
      await h.pool.query("UPDATE pgboss.version SET version=47");
      expect((await applyCoreMigrations(h.db, h.url)).ok).toBe(false);
      expect((await h.pool.query("SELECT version FROM pgboss.version")).rows).toEqual([
        { version: 47 },
      ]);
      expect(
        (await h.pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows,
      ).toEqual(before.rows);
    } finally {
      await h.close();
    }
  });

  it("recovers a prior failed index build, rejects a new BAM failure and releases competing migration locks", async () => {
    const h = await makeTestDb();
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await withCoreMigrationLock(h.url, async () => {
        await expect(
          withCoreMigrationLock(h.url, () => Promise.resolve("unexpected")),
        ).rejects.toThrow("Background queue schema admission failed");
      });
      expect(await withCoreMigrationLock(h.url, () => Promise.resolve("released"))).toBe(
        "released",
      );
      await migrateQueueSchema(h.url, AbortSignal.timeout(30_000));
      await h.pool.query(
        `INSERT INTO pgboss.bam(name,version,status,table_name,command)
        VALUES('synthetic_recovery',46,'failed','job_common',$1)`,
        [
          "CREATE INDEX CONCURRENTLY IF NOT EXISTS queue_contract_recovery_probe ON pgboss.job_common (name)",
        ],
      );
      // Fixture-only throttle reset: this test proves failed-row retry, not stale-build timing.
      await h.pool.query("UPDATE pgboss.version SET bam_on=NULL");
      await expect(assertRuntimeQueueSchema(h.url)).rejects.toThrow();
      await inspectQueueMigrationSource(h.url, AbortSignal.timeout(5_000));
      await migrateQueueSchema(h.url, AbortSignal.timeout(30_000));
      expect(
        (await h.pool.query("SELECT status FROM pgboss.bam WHERE name='synthetic_recovery'")).rows,
      ).toEqual([{ status: "completed" }]);
      expect(
        (
          await h.pool.query(
            "SELECT indisvalid FROM pg_index WHERE indexrelid='pgboss.queue_contract_recovery_probe'::regclass",
          )
        ).rows,
      ).toEqual([{ indisvalid: true }]);
      await assertRuntimeQueueSchema(h.url);

      await h.pool.query(
        `INSERT INTO pgboss.bam(name,version,status,table_name,command)
        VALUES('synthetic_failure',46,'pending','job_common',$1)`,
        [
          "CREATE INDEX CONCURRENTLY queue_contract_failure_probe ON pgboss.table_does_not_exist (name)",
        ],
      );
      await h.pool.query("UPDATE pgboss.version SET bam_on=NULL");
      await expect(migrateQueueSchema(h.url, AbortSignal.timeout(30_000))).rejects.toThrow(
        "Background queue schema admission failed",
      );
      expect(
        (await h.pool.query("SELECT status FROM pgboss.bam WHERE name='synthetic_failure'")).rows,
      ).toEqual([{ status: "failed" }]);
      await expect(assertRuntimeQueueSchema(h.url)).rejects.toThrow();
      expect(diagnostics).toHaveBeenCalledWith("pg-boss migration background error", {
        code: "queue_migration_background_error",
      });
      expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("table_does_not_exist");
    } finally {
      diagnostics.mockRestore();
      await h.close();
    }
  });

  it("rejects unreadable managed function bodies, swallowed catalog errors and empty constraint coverage", async () => {
    const h = await makeTestDb();
    // Deliberately reproduce the stock public drift API's best-effort gaps on real PG.
    const stock = new PgBoss({
      ...runtimeQueueOptions("app"),
      registerInstance: false,
      db: { executeSql: (text, values) => h.pool.query(text, values) },
    });
    try {
      await migrateQueueSchema(h.url, AbortSignal.timeout(30_000));
      const original = (
        await h.pool.query<{ definition: string }>(
          "SELECT pg_get_functiondef('pgboss.job_now()'::regprocedure) AS definition",
        )
      ).rows[0]!.definition;
      await h.pool.query(`CREATE OR REPLACE FUNCTION pgboss.job_now() RETURNS timestamptz
        LANGUAGE sql STABLE RETURN CURRENT_TIMESTAMP`);
      expect((await stock.detectSchemaDrift()).ok).toBe(true);
      await expect(assertRuntimeQueueSchema(h.url)).rejects.toThrow();
      await expect(
        inspectQueueMigrationSource(h.url, AbortSignal.timeout(5_000)),
      ).rejects.toThrow();
      // The explicit migrator must use the strict post-check too, even on current schema46.
      await expect(migrateQueueSchema(h.url, AbortSignal.timeout(30_000))).rejects.toThrow();
      await h.pool.query(original);
      await assertRuntimeQueueSchema(h.url);

      await h.pool.query(`CREATE AGGREGATE pgboss.queue_contract_catalog_aggregate(integer)
        (SFUNC=int4pl,STYPE=integer,INITCOND='0')`);
      expect((await stock.detectSchemaDrift()).ok).toBe(true);
      await expect(assertRuntimeQueueSchema(h.url)).rejects.toThrow();
      await expect(
        inspectQueueMigrationSource(h.url, AbortSignal.timeout(5_000)),
      ).rejects.toThrow();
      await h.pool.query("DROP AGGREGATE pgboss.queue_contract_catalog_aggregate(integer)");
      await assertRuntimeQueueSchema(h.url);

      await h.pool.query("ALTER TABLE pgboss.warning DROP CONSTRAINT warning_pkey");
      expect((await stock.detectSchemaDrift()).ok).toBe(true);
      await expect(assertRuntimeQueueSchema(h.url)).rejects.toThrow();
      await expect(
        inspectQueueMigrationSource(h.url, AbortSignal.timeout(5_000)),
      ).rejects.toThrow();
    } finally {
      await h.close();
    }
  });

  it("ends a startup query blocked after admission and closes its named connections", async () => {
    const h = await makeTestDb();
    const marker = `queue_failed_start_${randomUUID()}`;
    const boss = new PgBoss({
      connectionString: h.url,
      application_name: marker,
      ...runtimeQueueOptions("app"),
    });
    boss.on("error", () => undefined);
    const locker = await h.pool.connect();
    const published = vi.fn();
    let admitted = false;
    try {
      await migrateQueueSchema(h.url, AbortSignal.timeout(30_000));
      const started = performance.now();
      await expect(
        startAppBoss({
          createBoss: () => boss,
          async admit() {
            await assertRuntimeQueueSchema(h.url);
            admitted = true;
            await locker.query("BEGIN");
            await locker.query("LOCK TABLE pgboss.version IN ACCESS EXCLUSIVE MODE");
          },
          setBoss: published,
        }),
      ).rejects.toMatchObject({ code: "55P03" });
      expect(admitted).toBe(true);
      expect(performance.now() - started).toBeGreaterThan(1_000);
      expect(performance.now() - started).toBeLessThan(8_000);
      expect(published).not.toHaveBeenCalled();
      // Check while the lock remains held: cleanup cannot depend on releasing it.
      expect(
        (await h.pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1", [marker]))
          .rows,
      ).toEqual([]);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      await boss.stop({ graceful: false, timeout: 1_000 });
      await h.close();
    }
  });

  it("retires startup connections when a transport drops query responses after admission", async () => {
    const h = await makeTestDb();
    const target = new URL(h.url);
    const sockets = new Set<Socket>();
    let droppedQueries = 0;
    const proxy = createServer((downstream) => {
      const upstream = createConnection({
        host: target.hostname,
        port: Number(target.port) || 5432,
      });
      sockets.add(downstream);
      sockets.add(upstream);
      let dropResponses = false;
      downstream.on("data", (chunk: Buffer) => {
        // Forward real PostgreSQL authentication, then blackhole each simple-query response.
        if (chunk[0] === 0x51) {
          dropResponses = true;
          droppedQueries += 1;
        }
        upstream.write(chunk);
      });
      upstream.on("data", (chunk: Buffer) => {
        if (!dropResponses) downstream.write(chunk);
      });
      downstream.on("error", () => upstream.destroy());
      upstream.on("error", () => downstream.destroy());
      downstream.on("close", () => {
        sockets.delete(downstream);
        upstream.destroy();
      });
      upstream.on("close", () => {
        sockets.delete(upstream);
        downstream.destroy();
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (address === null || typeof address === "string")
      throw new Error("Fixture proxy did not bind");
    const proxyUrl = new URL(h.url);
    proxyUrl.hostname = "127.0.0.1";
    proxyUrl.port = String(address.port);
    const marker = `queue_transport_start_${randomUUID()}`;
    const options = {
      ...runtimeQueueOptions("app"),
      connectionString: proxyUrl.toString(),
      application_name: marker,
      query_timeout: 150,
      connectionTimeoutMillis: 500,
    };
    const boss = new PgBoss(options);
    boss.on("error", () => undefined);
    const published = vi.fn();
    try {
      await migrateQueueSchema(h.url, AbortSignal.timeout(30_000));
      const started = performance.now();
      await expect(
        startAppBoss({
          createBoss: () => boss,
          admit: () => assertRuntimeQueueSchema(h.url),
          setBoss: published,
        }),
      ).rejects.toThrow("Query read timeout");
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(droppedQueries).toBeGreaterThan(0);
      expect(published).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 2_000, interval: 20 });
      expect(
        (await h.pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1", [marker]))
          .rows,
      ).toEqual([]);
    } finally {
      await boss.stop({ graceful: false, timeout: 1_000 });
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
      await h.close();
    }
  });
});
