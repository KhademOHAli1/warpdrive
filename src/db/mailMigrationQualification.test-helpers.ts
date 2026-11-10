import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type QueryResultRow } from "pg";
import { expect } from "vitest";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import * as schema from "./schema";
import { forceRemoveQualificationContainer, qualificationDeadline, qualificationSettles } from "./mailMigrationQualificationDeadline";
import { assertQualificationInputs, qualificationSources, type QualificationSources } from "./mailMigrationQualificationSource";

export function qualificationIdentifier(name: string): string {
  return "\"" + name.replace(/"/g, '""') + "\"";
}
export async function qualificationQuery<T extends QueryResultRow = QueryResultRow>(
  pool: Pick<Pool, "query">, text: string, values: unknown[], signal: AbortSignal,
) {
  signal.throwIfAborted();
  const result = await pool.query<T>(text, values);
  signal.throwIfAborted();
  return result;
}
export interface QualificationDatabase { name: string; pool: Pool; db: ReturnType<typeof qualificationDrizzle>; sources: QualificationSources; interrupt: () => Promise<void> }
function qualificationDrizzle(pool: Pool) { return drizzle(pool, { schema }); }
export async function qualificationMigrate(database: QualificationDatabase, folder: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await assertQualificationInputs(database.sources,folder,signal);
  await qualificationDeadline(() => migrate(database.db, { migrationsFolder: folder }), {
    signal,milliseconds:120_000,phase:"database-migrations",interrupt:database.interrupt,
  });
  signal.throwIfAborted();
}

class QualificationPostgresContainer extends PostgreSqlContainer {
  constructor(private readonly beforeCreate: () => Promise<void>, private readonly created: (id: string) => Promise<void>) { super("postgres:16-alpine"); }
  protected override async beforeContainerCreated(): Promise<void> { await this.beforeCreate(); }
  protected override async containerCreated(id: string): Promise<void> { await this.created(id); }
}

export class MailMigrationQualificationHarness {
  private readonly databases = new Set<QualificationDatabase>();
  private backendFailed = false;
  private closing = false;
  private closePromise: Promise<void> | undefined;
  forcedStopComplete = false;

  private constructor(
    readonly container: StartedPostgreSqlContainer, readonly sources: QualificationSources,
    private readonly admin: Pool, readonly ownedName: string,
  ) { admin.on("error", () => { if (!this.closing) this.backendFailed = true; }); }

  static async start(signal: AbortSignal) {
    const sources = await qualificationSources(signal);
    const name = "wd-mail-qualification-" + randomUUID();
    let container: StartedPostgreSqlContainer | undefined;
    let createdId: string | undefined;
    let abandoned = false;
    const checkStarting = () => {
      signal.throwIfAborted();
      if (abandoned) throw new AppError(ERROR_IDS.DB_INVARIANT,"Qualification container startup was abandoned");
      return Promise.resolve();
    };
    const builder = new QualificationPostgresContainer(checkStarting,async (id) => {
      createdId = id;
      if (abandoned || signal.aborted) {
        expect(await forceRemoveQualificationContainer(name,undefined,id)).toBe(true);
        await checkStarting();
      }
    })
      .withName(name).withDatabase("mail_qualification_admin").withUsername("mail_qualification")
      .withPassword(randomUUID()).withLabels({ "warpdrive.qualification": "mail-migrations" })
      .withStartupTimeout(45_000)
      .withCommand(["postgres", "-c", "max_connections=30", "-c", "fsync=off", "-c", "full_page_writes=off"]);
    try {
      signal.throwIfAborted();
      container = await qualificationDeadline(() => builder.start().then(async (started) => {
        container = started;
        if (abandoned || signal.aborted) {
          expect(await forceRemoveQualificationContainer(name,started,createdId)).toBe(true);
          await checkStarting();
        }
        return started;
      },async (error: unknown) => {
        if (abandoned) expect(await forceRemoveQualificationContainer(name,container,createdId)).toBe(true);
        throw error;
      }), {
        signal, milliseconds: 60_000, phase: "container-start",
        interrupt: async () => { abandoned = true; await forceRemoveQualificationContainer(name, container,createdId); },
      });
      const admin = new Pool({ connectionString: container.getConnectionUri(), max: 2, connectionTimeoutMillis: 5000, query_timeout: 30_000, statement_timeout: 30_000 });
      return new MailMigrationQualificationHarness(container, sources, admin, name);
    } catch (error) {
      abandoned = true;
      let stopped = false;
      let removed = false;
      try { stopped = await forceRemoveQualificationContainer(name, container,createdId); }
      finally { removed = await qualificationSettles(() => rm(sources.temporary, { recursive: true, force: true }),5000); }
      if (!stopped || !removed) {
        process.stderr.write("MAIL_MIGRATION_QUALIFICATION_STARTUP_CLEANUP_UNCONFIRMED\n");
        if (!signal.aborted) throw new AppError(ERROR_IDS.DB_INVARIANT,"Qualification startup cleanup was not confirmed",{stopped,removed});
      }
      throw error;
    }
  }

  async database(signal: AbortSignal): Promise<QualificationDatabase> {
    const name = "mq_" + randomUUID().replaceAll("-", "");
    await qualificationQuery(this.admin, "CREATE DATABASE " + qualificationIdentifier(name) + " TEMPLATE template0", [], signal);
    const pool = new Pool({ host: this.container.getHost(), port: this.container.getPort(), user: this.container.getUsername(), password: this.container.getPassword(), database: name, max: 2, connectionTimeoutMillis: 5000, query_timeout: 30_000, statement_timeout: 30_000, options: "-c timezone=UTC" });
    pool.on("error", () => { if (!this.closing) this.backendFailed = true; });
    const database = { name, pool, db: qualificationDrizzle(pool),sources:this.sources,interrupt:async () => { await this.interrupt(); } };
    this.databases.add(database);
    return database;
  }

  async prefix(database: QualificationDatabase, end: 82 | 84 | 90, signal: AbortSignal) {
    expect(this.databases.has(database)).toBe(true);
    const folder = this.sources.prefixes.get(end);
    expect(folder).toBeDefined();
    if (folder !== undefined) await qualificationMigrate(database, folder, signal);
  }

  async archiveCommand(args: string[], signal: AbortSignal, milliseconds = 60_000) {
    const result = await qualificationDeadline(
      () => this.container.exec(args, { env: { PGPASSWORD: this.container.getPassword(), PGCONNECT_TIMEOUT: "5" } }),
      {
        signal, milliseconds, phase: "archive-command",
        interrupt: async () => { await this.interrupt(); },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim() === "").toBe(true);
    return result.stdout.trim();
  }

  async dumpRestore(source: QualificationDatabase, signal: AbortSignal) {
    expect(this.databases.has(source)).toBe(true);
    const destination = await this.database(signal);
    const archive = "/tmp/mail-qualification-" + randomUUID() + ".dump";
    const server = await qualificationQuery<{ server_version: string }>(source.pool, "SHOW server_version", [], signal);
    const serverVersion = server.rows[0]?.server_version ?? "";
    const dumpVersion = await this.archiveCommand(["pg_dump", "--version"], signal);
    const restoreVersion = await this.archiveCommand(["pg_restore", "--version"], signal);
    expect(serverVersion).toMatch(/^16\./);
    expect(dumpVersion).toMatch(/PostgreSQL\) 16\./);
    expect(restoreVersion).toMatch(/PostgreSQL\) 16\./);
    try {
      await this.archiveCommand(["pg_dump", "--host=127.0.0.1", "--username=" + this.container.getUsername(), "--dbname=" + source.name, "--format=custom", "--lock-wait-timeout=5000", "--file=" + archive], signal);
      const digest = await this.archiveCommand(["sha256sum", archive], signal);
      const archiveHash = z.string().regex(/^[a-f0-9]{64}$/).parse(digest.split(/\s+/)[0]);
      await this.archiveCommand(["pg_restore", "--host=127.0.0.1", "--username=" + this.container.getUsername(), "--dbname=" + destination.name, "--exit-on-error", "--no-owner", "--no-acl", archive], signal);
      return { database: destination, evidence: { serverVersion, dumpVersion, restoreVersion, archiveHash, dumpExitCode: 0, restoreExitCode: 0 } };
    } finally {
      if (!this.closing) await this.archiveCommand(["rm", "--", archive], AbortSignal.timeout(5000), 4000);
    }
  }

  close(): Promise<void> { return this.closePromise ??= this.finishClose(); }

  private async interrupt(): Promise<void> {
    this.closing = true;
    this.forcedStopComplete = await forceRemoveQualificationContainer(this.ownedName,this.container);
  }

  private async finishClose(): Promise<void> {
    this.closing = true;
    const draining = Promise.allSettled([...this.databases].map((database) => database.pool.end()).concat(this.admin.end()));
    let drained = false;
    let stopped = this.forcedStopComplete;
    let removed = false;
    try { drained = await qualificationSettles(() => draining, 5000); }
    finally {
      try {
        if (!stopped) stopped = await forceRemoveQualificationContainer(this.ownedName, this.container);
        this.forcedStopComplete = stopped;
      } finally {
        removed = await qualificationSettles(() => rm(this.sources.temporary, { recursive: true, force: true }), 5000);
      }
    }
    if (!drained) drained = await qualificationSettles(() => draining, 5000);
    expect(stopped && removed && drained).toBe(true);
    if (drained) expect((await draining).every((result) => result.status === "fulfilled")).toBe(true);
    expect(this.backendFailed).toBe(false);
  }
}
