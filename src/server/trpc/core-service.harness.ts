import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import superjson from "superjson";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { applyCoreMigrations } from "@/db/migrate";
import * as schema from "@/db/schema";
import { createBetterAuth } from "@/features/auth/better/auth";
import { nativeAuthGateway } from "@/features/auth/better/nativeGateway";
import {
  hashSessionCredential,
  readCookie,
  sessionTokenFromCookie,
} from "@/features/auth/better/sessionToken";
import { mintCsrfToken } from "@/features/auth/csrf";
import type { SavedPerformanceDefinition } from "@/features/stats/savedPerformanceReports";
import type { AppRouter } from "./root";

type Configuration = {
  owner: string;
  runtime: string;
  scratch: string;
  nonce: string;
  commonEnvironment: Record<string, string>;
  bundleDirectory?: string;
};
type ChildExit = { code: number | null; signal: NodeJS.Signals | null };
type ManagedChild = {
  name: string;
  process: ChildProcess;
  origin: string;
  log: string;
  exit: ChildExit | undefined;
  finished: Promise<ChildExit>;
};
type MetadataMode = "healthy" | "old" | "malformed" | "hold";
type FixtureUsers = {
  users: [string, string];
  people: [string, string];
  cookies: [string, string];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateScratch(path: string, scratch: string): void {
  assert(realpathSync(scratch) === scratch && dirname(realpathSync(path)) === scratch);
  assert(basename(scratch).startsWith("core-service-owned-"));
  const directory = lstatSync(scratch),
    file = lstatSync(path);
  assert(
    directory.isDirectory() &&
      !directory.isSymbolicLink() &&
      directory.uid === process.getuid?.() &&
      (directory.mode & 0o077) === 0,
  );
  assert(
    file.isFile() &&
      !file.isSymbolicLink() &&
      file.uid === process.getuid() &&
      (file.mode & 0o077) === 0,
  );
}
function loadConfiguration(): Configuration {
  const path = process.argv[2];
  assert(path !== undefined, "Owned fixture configuration required");
  const input: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert(
    record(input) &&
      typeof input.owner === "string" &&
      typeof input.runtime === "string" &&
      typeof input.scratch === "string" &&
      typeof input.nonce === "string" &&
      record(input.commonEnvironment),
  );
  assert(/^[a-f0-9]{32}$/u.test(input.nonce), "Owned cluster marker required");
  validateScratch(path, input.scratch);
  const bundleDirectory = input.bundleDirectory;
  if (bundleDirectory !== undefined) {
    assert(bundleDirectory === join(input.scratch, "runtime"));
    const bundle = join(bundleDirectory, "dist/core-api.mjs");
    assert(realpathSync(bundle) === bundle && lstatSync(bundle).isFile());
  }
  const commonEnvironment: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.commonEnvironment)) {
    assert(typeof value === "string", "Fixture environment values must be strings");
    assert(
      !key.endsWith("_FILE") && !key.startsWith("PG"),
      "Fixture secret files and libpq environment disabled",
    );
    commonEnvironment[key] = value;
  }
  const owner = new URL(input.owner),
    runtime = new URL(input.runtime);
  for (const url of [owner, runtime])
    assert(
      url.protocol === "postgres:" &&
        url.hostname === "127.0.0.1" &&
        url.pathname === "/core_service_fixture" &&
        url.search === "" &&
        url.hash === "",
    );
  assert(
    owner.username === "core_service_owner" &&
      runtime.username === "smoke_runtime" &&
      owner.port === runtime.port,
  );
  assert(
    env.DATABASE_URL === input.owner &&
      env.DISABLE_TELEMETRY &&
      env.AUTH_ALLOW_PASSWORD &&
      env.NODE_ENV === "test",
  );
  assert(
    !("MIGRATION_DATABASE_URL" in commonEnvironment) &&
      !("MIGRATION_DATABASE_URL_FILE" in commonEnvironment) &&
      !("DATABASE_URL" in commonEnvironment),
  );
  return {
    owner: input.owner,
    runtime: input.runtime,
    scratch: input.scratch,
    nonce: input.nonce,
    commonEnvironment,
    bundleDirectory,
  };
}
function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
async function within<Value>(operation: Promise<Value>, timeoutMs: number): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TypeError("Fixture deadline")), timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    assert(performance.now() < deadline, "Fixture condition deadline");
    await delay(25);
  }
}
async function unusedPort(): Promise<number> {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

function metadataFixture() {
  let mode: MetadataMode = "healthy",
    version = "1.2.3",
    requests = 0,
    credentials = 0;
  let arrival = deferred<void>(),
    release = deferred<void>();
  const pending = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    if (request.url !== "/api/runtime/web-identity" || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }
    requests++;
    if (request.headers.cookie !== undefined || request.headers.authorization !== undefined)
      credentials++;
    const respond = () => {
      if (mode === "old") {
        response.writeHead(404, { "content-type": "text/plain" }).end("Missing");
        return;
      }
      const body =
        mode === "malformed"
          ? '{"contract":"legacy"}'
          : JSON.stringify({
              contract: "warpdrive.web.identity.v1",
              component: "web",
              version,
              sourceRevision: "a".repeat(40),
            });
      response
        .writeHead(200, {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
        })
        .end(body);
    };
    if (mode !== "hold") {
      respond();
      return;
    }
    pending.add(response);
    response.once("close", () => pending.delete(response));
    arrival.resolve(undefined);
    void release.promise.then(respond);
  });
  return {
    async start() {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert(address !== null && typeof address !== "string");
      return `http://127.0.0.1:${address.port}`;
    },
    configure(next: MetadataMode, nextVersion = version) {
      release.resolve(undefined);
      mode = next;
      version = nextVersion;
      arrival = deferred<void>();
      release = deferred<void>();
    },
    arrival: () => arrival.promise,
    release() {
      mode = "healthy";
      release.resolve(undefined);
    },
    facts: () => ({ requests, credentials, pending: pending.size }),
    async close() {
      release.resolve(undefined);
      for (const response of pending) response.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    },
  };
}

function errorCode(error: unknown): string | null {
  if (!record(error) || !record(error.data)) return null;
  return typeof error.data.code === "string" ? error.data.code : null;
}
function wireClient(origin: string, cookie: string, observed: { posts: number; timing: number }) {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${origin}/api/trpc`,
        transformer: superjson,
        headers: { cookie, origin: new URL(env.BASE_URL).origin, "sec-fetch-site": "same-origin" },
        fetch: async (input, init) => {
          if (init?.method === "POST") observed.posts++;
          const response = await fetch(input, { ...init, signal: AbortSignal.timeout(5000) });
          assert(/^trpc;dur=\d+(?:\.\d+)?$/u.test(response.headers.get("server-timing") ?? ""));
          observed.timing++;
          return response;
        },
      }),
    ],
  });
}

async function seedUsers(db: Db): Promise<FixtureUsers> {
  const users: [string, string] = [randomUUID(), randomUUID()],
    people: [string, string] = [randomUUID(), randomUUID()];
  const password = `Core-service-${randomBytes(24).toString("base64url")}`;
  const emails: [string, string] = [
    `service-a-${users[0]}@example.test`,
    `service-b-${users[1]}@example.test`,
  ];
  for (let index = 0; index < users.length; index++) {
    const id = users[index],
      email = emails[index];
    assert(id !== undefined && email !== undefined);
    await db.insert(schema.users).values({ id, email, name: "Core service fixture" });
    await db
      .insert(schema.authUsers)
      .values({ id, email, name: "Core service fixture", emailVerified: true });
  }
  const native = await createBetterAuth(db).$context;
  const hash = await native.password.hash(password);
  for (const id of users)
    await db
      .insert(schema.authAccounts)
      .values({ userId: id, accountId: id, providerId: "credential", password: hash });
  await db.insert(schema.persons).values([
    { id: people[0], ownerId: users[0], name: "Core private A", visibilityLevel: "owner" },
    { id: people[1], ownerId: users[1], name: "Core private B", visibilityLevel: "owner" },
  ]);
  const signIn = async (email: string): Promise<string> => {
    const origin = new URL(env.BASE_URL).origin;
    const response = await nativeAuthGateway(
      db,
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          origin,
          host: new URL(origin).host,
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    assert.equal(response.status, 200, "Native password issuance must succeed");
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0] ?? "")
      .join("; ");
    const value = readCookie(new Headers({ cookie }), "wd_sid");
    const token = value === null ? null : sessionTokenFromCookie(value);
    assert(token !== null, "Actual native session credential required");
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashSessionCredential(token)))
      .limit(1);
    assert(
      session !== undefined && session.authMethod !== "legacy",
      "Native issuance persists a modern session",
    );
    return cookie;
  };
  return { users, people, cookies: [await signIn(emails[0]), await signIn(emails[1])] };
}

function childManager(configuration: Configuration, metadataOrigin: string) {
  const children: ManagedChild[] = [];
  let bytes = 0;
  function manifest(): void {
    const path = join(configuration.scratch, "core-child-handles.json");
    writeFileSync(
      `${path}.next`,
      JSON.stringify([
        { name: "metadata", pid: process.pid, origin: metadataOrigin },
        ...children.map((child) => ({
          name: child.name,
          pid: child.process.pid,
          origin: child.origin,
        })),
      ]),
      { mode: 0o600 },
    );
    renameSync(`${path}.next`, path);
  }
  return {
    async start(name: string, owner = false): Promise<ManagedChild> {
      const port = await unusedPort(),
        origin = `http://127.0.0.1:${port}`;
      const bundleDirectory = configuration.bundleDirectory;
      const child = spawn(
        process.execPath,
        bundleDirectory === undefined
          ? ["--no-env-file", "--smol", "run", "src/entrypoints/core-api.ts"]
          : ["--no-env-file", "--smol", "dist/core-api.mjs"],
        {
          cwd: bundleDirectory ?? process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...configuration.commonEnvironment,
            ...(bundleDirectory === undefined
              ? { NODE_ENV: "test" }
              : {
                  NODE_ENV: "production",
                  AUTH_MAIL_TRANSPORT: "smtp",
                  AUTH_SMTP_HOST: "127.0.0.1",
                  AUTH_SMTP_PORT: "1",
                  SEED_ADMIN_EMAIL: "fixture-admin@example.test",
                }),
            DATABASE_URL: owner ? configuration.owner : configuration.runtime,
            RUNTIME_COMPONENT: "core-api",
            CORE_HOST: "127.0.0.1",
            CORE_PORT: String(port),
            CORE_WEB_ORIGIN: metadataOrigin,
            CORE_DB_MAX: "4",
            CORE_PRODUCER_DB_MAX: "1",
            CORE_DB_CONNECT_MS: "1000",
            CORE_DB_STATEMENT_MS: "10000",
            CORE_DB_QUERY_MS: "12000",
            CORE_DB_LOCK_MS: "500",
            APP_VERSION: "9.9.9",
            APP_COMMIT: "b".repeat(40),
          },
        },
      );
      assert(child.pid !== undefined, "Core child must spawn");
      const finished = deferred<ChildExit>();
      const managed: ManagedChild = {
        name,
        process: child,
        origin,
        log: "",
        exit: undefined,
        finished: finished.promise,
      };
      children.push(managed);
      manifest();
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", (value: string) => {
          bytes += Buffer.byteLength(value);
          if (bytes > 1024 * 1024) child.kill("SIGKILL");
          else {
            managed.log += value;
            // Raw child logs remain private fixture diagnostics, never a sanitized artifact.
            writeFileSync(join(configuration.scratch, `${name}.log`), managed.log, { mode: 0o600 });
          }
        });
      }
      child.once("exit", (code, signal) => {
        managed.exit = { code, signal };
      });
      child.once("close", (code, signal) => {
        managed.exit = { code, signal };
        finished.resolve(managed.exit);
      });
      child.once("error", () => {
        managed.exit = { code: null, signal: null };
        finished.resolve(managed.exit);
      });
      console.warn(JSON.stringify({ event: "core.service.child", name, pid: child.pid, origin }));
      return managed;
    },
    async close() {
      const results = await Promise.allSettled(
        children.map(async (child) => {
          if (child.exit !== undefined) return;
          child.process.kill("SIGTERM");
          try {
            await within(child.finished, 2000);
          } catch {
            child.process.kill("SIGKILL");
            await within(child.finished, 2000);
          }
        }),
      );
      assert(
        results.every((result) => result.status === "fulfilled"),
        "Every fixture child cleanup attempted",
      );
    },
    facts: () => ({
      children: children.length,
      logBytes: bytes,
      allExited: children.every((child) => child.exit !== undefined),
    }),
  };
}

function shutdownOutcomes(child: ManagedChild): unknown[] {
  return child.log.split("\n").flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return record(value) && value.event === "runtime.shutdown" ? [value] : [];
    } catch {
      return [];
    }
  });
}
async function requestStatus(origin: string, path: string): Promise<number | null> {
  try {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(200) });
    const status = response.status;
    await response.body?.cancel();
    return status;
  } catch {
    return null;
  }
}
async function ready(child: ManagedChild): Promise<void> {
  await waitFor(async () => {
    assert(child.exit === undefined, "Real Core exited before readiness");
    return (await requestStatus(child.origin, "/readyz")) === 200;
  }, 25000);
  assert.equal(await requestStatus(child.origin, "/healthz"), 200);
}
async function producerRows(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM pgboss.instance WHERE application_name='warpdrive-core-producer'",
  );
  const count = result.rows[0]?.count;
  assert(count !== undefined);
  return count;
}
async function registry(pool: Pool, heartbeat: boolean): Promise<void> {
  let initialHeartbeat: string | undefined;
  await waitFor(
    async () => {
      const result = await pool.query<{
        workers: unknown;
        supervise: boolean;
        schedule: boolean;
        migrate: boolean;
        pool_max: number;
        heartbeat_on: Date;
        config: unknown;
      }>(
        "SELECT workers,supervise,schedule,migrate,pool_max,heartbeat_on,config FROM pgboss.instance WHERE application_name='warpdrive-core-producer' AND stopped_on IS NULL",
      );
      if (result.rows.length !== 1) return false;
      const row = result.rows[0];
      assert(row !== undefined);
      assert(
        Array.isArray(row.workers) &&
          row.workers.length === 0 &&
          !row.supervise &&
          !row.schedule &&
          !row.migrate &&
          row.pool_max === 1,
        "Actual producer must have no consumers or migrator duties",
      );
      assert(record(row.config) && row.config.useListenNotify === false && row.config.max === 1);
      if (!heartbeat) return true;
      const stamp = row.heartbeat_on.toISOString();
      if (initialHeartbeat === undefined) {
        initialHeartbeat = stamp;
        return false;
      }
      return stamp !== initialHeartbeat;
    },
    heartbeat ? 35000 : 5000,
  );
}
async function noCoreBackends(pool: Pool): Promise<void> {
  await waitFor(async () => {
    const result = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('warpdrive-core-api','warpdrive-core-producer')",
    );
    return result.rows[0]?.count === 0;
  }, 3000);
}
async function checkReads(
  child: ManagedChild,
  fixture: FixtureUsers,
  observed: { posts: number; timing: number },
) {
  const a = wireClient(child.origin, fixture.cookies[0], observed),
    b = wireClient(child.origin, fixture.cookies[1], observed);
  const [ownA, ownB] = await Promise.all([
    a.contacts.getPerson.query({ id: fixture.people[0] }),
    b.contacts.getPerson.query({ id: fixture.people[1] }),
  ]);
  assert(
    ownA.ownerId === fixture.users[0] &&
      ownB.ownerId === fixture.users[1] &&
      ownA.createdAt instanceof Date &&
      ownB.createdAt instanceof Date,
  );
  await Promise.all([
    assert.rejects(
      a.contacts.getPerson.query({ id: fixture.people[1] }),
      (error: unknown) => errorCode(error) === "NOT_FOUND",
    ),
    assert.rejects(
      b.contacts.getPerson.query({ id: fixture.people[0] }),
      (error: unknown) => errorCode(error) === "NOT_FOUND",
    ),
    assert.rejects(
      wireClient(child.origin, "", observed).version.get.query(),
      (error: unknown) => errorCode(error) === "UNAUTHORIZED",
    ),
  ]);
  assert.equal((await a.version.get.query()).current, "1.2.3");
  return a;
}
async function checkMutation(
  db: Db,
  child: ManagedChild,
  fixture: FixtureUsers,
  observed: { posts: number; timing: number },
): Promise<void> {
  const token = mintCsrfToken(),
    client = wireClient(child.origin, `${fixture.cookies[0]}; wd_csrf=${token}`, observed);
  const name = `Native Core report ${randomUUID()}`;
  const definition: SavedPerformanceDefinition = {
    version: 1,
    from: "2026-01-01",
    to: "2026-01-31",
    currency: "EUR",
    pipelineId: null,
    ownerScope: { kind: "me" },
  };
  const posts = observed.posts;
  await assert.rejects(
    client.stats.savedPerformance.create.mutate({ name, definition, csrfToken: null }),
    (error: unknown) => errorCode(error) === "FORBIDDEN",
  );
  assert.equal(
    (await db.select().from(schema.savedFilters).where(eq(schema.savedFilters.name, name))).length,
    0,
  );
  const created = await client.stats.savedPerformance.create.mutate({
    name,
    definition,
    csrfToken: token,
  });
  assert(created.state === "created");
  const [saved] = await db
    .select()
    .from(schema.savedFilters)
    .where(eq(schema.savedFilters.id, created.id));
  assert(
    saved !== undefined &&
      saved.ownerId === fixture.users[0] &&
      saved.targetEntity === "stats-performance-report" &&
      saved.isShared === false,
  );
  assert.deepEqual(saved.definition, definition);
  assert.equal(
    (await client.stats.savedPerformance.load.query({ id: created.id })).state,
    "loaded",
  );
  assert.equal(
    (await client.stats.savedPerformance.remove.mutate({ id: created.id, csrfToken: token })).state,
    "removed",
  );
  assert.equal(
    (await db.select().from(schema.savedFilters).where(eq(schema.savedFilters.id, created.id)))
      .length,
    0,
  );
  assert.equal(
    observed.posts - posts,
    3,
    "One denied POST plus one create and one remove; no mutation replay",
  );
}

async function negativeStartup(
  manager: ReturnType<typeof childManager>,
  metadata: ReturnType<typeof metadataFixture>,
  pool: Pool,
  mode: "old" | "malformed" | "owner",
): Promise<void> {
  metadata.configure(mode === "owner" ? "healthy" : mode);
  const before = await producerRows(pool),
    requests = metadata.facts().requests;
  const child = await manager.start(`negative_${mode}`, mode === "owner");
  let exposed = false;
  const listenerExposed = (): boolean => exposed;
  await waitFor(async () => {
    if ((await requestStatus(child.origin, "/healthz")) !== null) exposed = true;
    return child.exit !== undefined;
  }, 15000);
  const outcome = await child.finished;
  assert(
    outcome.code === 1 && !listenerExposed() && (await producerRows(pool)) === before,
    "Unadmitted startup has no observed listener or producer registration",
  );
  const outcomes = shutdownOutcomes(child);
  assert.equal(outcomes.length, 1);
  assert.deepEqual(outcomes[0], {
    event: "runtime.shutdown",
    source: "core-api",
    status: "failed",
    step: "runtime",
    exitCode: 1,
  });
  if (mode === "owner")
    assert.equal(
      metadata.facts().requests,
      requests,
      "Owner credentials fail before metadata/producer",
    );
  await noCoreBackends(pool);
}

async function drainWithHeldVersion(
  child: ManagedChild,
  metadata: ReturnType<typeof metadataFixture>,
  client: ReturnType<typeof wireClient>,
): Promise<void> {
  metadata.configure("hold");
  let pending: ReturnType<typeof client.version.get.query> | undefined;
  const deadline = performance.now() + 3000;
  while (pending === undefined) {
    const attempt = client.version.get.query();
    const outcome = await Promise.race([
      attempt.then(() => "cached"),
      metadata.arrival().then(() => "held"),
    ]);
    if (outcome === "held") pending = attempt;
    else {
      assert(performance.now() < deadline);
      await delay(25);
    }
  }
  let responseComplete = false;
  const completed = (): boolean => responseComplete;
  const response = pending.then((value) => {
    responseComplete = true;
    return value;
  });
  assert(
    child.process.kill("SIGTERM") && child.process.kill("SIGINT"),
    "Both native signals must be delivered",
  );
  await waitFor(async () => (await requestStatus(child.origin, "/readyz")) !== 200, 500);
  assert(
    child.exit === undefined && !completed() && metadata.facts().pending === 1,
    "Admitted response survives until actual metadata release",
  );
  metadata.release();
  assert.equal((await response).current, "1.2.4");
  assert.deepEqual(await within(child.finished, 10000), { code: 0, signal: null });
  const outcomes = shutdownOutcomes(child);
  assert.equal(outcomes.length, 1, "Repeated signals share one actual drain");
  assert.deepEqual(outcomes[0], {
    event: "runtime.shutdown",
    source: "core-api",
    status: "drained",
    step: "runtime",
    exitCode: 0,
  });
}

async function main(): Promise<void> {
  const configuration = loadConfiguration();
  const pool = new Pool({
    connectionString: configuration.owner,
    max: 1,
    connectionTimeoutMillis: 1000,
    query_timeout: 15000,
    statement_timeout: 10000,
    lock_timeout: 1000,
    application_name: "core-service-fixture-owner",
  });
  const db = drizzle(pool, { schema });
  const metadata = metadataFixture();
  const origin = await metadata.start();
  const manager = childManager(configuration, origin);
  const observed = { posts: 0, timing: 0 };
  let stage = "owner_migrations";
  try {
    const marker = await pool.query<{ nonce: string; name: string; role: string }>(
      "SELECT current_setting('warpdrive.fixture_nonce',true) AS nonce,current_database() AS name,current_user AS role",
    );
    assert(
      marker.rows.length === 1 &&
        marker.rows[0]?.nonce === configuration.nonce &&
        marker.rows[0].name === "core_service_fixture" &&
        marker.rows[0].role === "core_service_owner",
      "Owner setup requires this supervisor's actual marked cluster",
    );
    const migrated = await applyCoreMigrations(db, configuration.owner, AbortSignal.timeout(60000));
    assert(migrated.ok, "Actual canonical and queue migrator must admit fixture");
    stage = "native_auth_setup";
    const fixture = await seedUsers(db);
    await pool.query(
      "CREATE ROLE smoke_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public,pgboss TO smoke_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,pgboss TO smoke_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,pgboss TO smoke_runtime; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,pgboss TO smoke_runtime;",
    );
    stage = "real_entrypoint_ready";
    const child = await manager.start("positive");
    await ready(child);
    await registry(pool, false);
    stage = "authenticated_full_router";
    const client = await checkReads(child, fixture, observed);
    await checkMutation(db, child, fixture, observed);
    stage = "web_identity_swap";
    const requests = metadata.facts().requests;
    metadata.configure("healthy", "1.2.4");
    await waitFor(async () => (await client.version.get.query()).current === "1.2.4", 5000);
    assert(
      metadata.facts().requests > requests && child.exit === undefined,
      "Web version refreshes after real TTL without Core restart",
    );
    stage = "live_producer_heartbeat_no_consumers";
    console.warn(JSON.stringify({ event: "core.service.stage", stage }));
    await registry(pool, true);
    stage = "native_signal_drain";
    await drainWithHeldVersion(child, metadata, client);
    await noCoreBackends(pool);
    stage = "negative_metadata_and_role";
    await negativeStartup(manager, metadata, pool, "old");
    await negativeStartup(manager, metadata, pool, "malformed");
    await negativeStartup(manager, metadata, pool, "owner");
    assert.equal(
      metadata.facts().credentials,
      0,
      "No user credential forwarded to metadata fixture",
    );
    assert.equal(metadata.facts().pending, 0);
    console.warn(
      JSON.stringify({
        event: "core.service.proof",
        status: "pass",
        authenticatedOwners: 2,
        crossOwnerDenials: 2,
        positiveMutations: 2,
        mutationCsrfDenials: 1,
        versionRefreshWithoutRestart: true,
        liveRegistryConsumers: 0,
        repeatedSignalDrain: true,
        negativeStartupCases: 3,
        timingResponses: observed.timing,
        postRequests: observed.posts,
        childFacts: manager.facts(),
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        event: "core.service.proof",
        status: "failed",
        stage,
        childFacts: manager.facts(),
      }),
    );
    process.exitCode = 1;
  } finally {
    metadata.release();
    const cleanup = await Promise.allSettled([manager.close(), metadata.close(), pool.end()]);
    if (cleanup.some((result) => result.status === "rejected")) {
      console.error(
        JSON.stringify({ event: "core.service.proof", status: "failed", stage: "fixture_cleanup" }),
      );
      process.exitCode = 1;
    }
  }
}
void main().catch(() => {
  console.error(
    JSON.stringify({ event: "core.service.proof", status: "failed", stage: "fixture_lifecycle" }),
  );
  process.exitCode = 1;
});
