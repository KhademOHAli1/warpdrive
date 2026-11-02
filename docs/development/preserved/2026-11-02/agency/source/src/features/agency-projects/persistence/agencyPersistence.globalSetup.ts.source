import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  type ContainerRuntimeClient,
  getContainerRuntimeClient,
  ImageName,
  PullPolicy,
} from "testcontainers";
import { getReaperImage } from "testcontainers/build/reaper/reaper";
import type { TestProject } from "vitest/node";
import type { TestPgConnection } from "../../../../vitest.globalSetup";
import { type AgencyFixtureSource, legacyFixtureSource } from "./agencyPersistence.fixtureManifest";

const OVERLAY = fileURLToPath(new URL("./0099_agency_projects.sql", import.meta.url));
const TEMPLATE = "wd_agency_template";
const PG_IMAGE = "postgres:16-alpine";
class OwnedPostgreSqlContainer extends PostgreSqlContainer {
  createdId: string | null = null;
  protected override containerCreated(containerId: string): Promise<void> {
    this.createdId = containerId;
    console.warn(JSON.stringify({ fixture: "agency-persistence", containerId, phase: "created" }));
    return Promise.resolve();
  }
}
async function readOverlay(signal: AbortSignal): Promise<string | null> {
  try {
    if (!(await lstat(OVERLAY)).isFile()) throw new TypeError("Agency SQL overlay is not regular");
    signal.throwIfAborted();
    const sql = await readFile(OVERLAY, { encoding: "utf8", signal });
    if (sql.trim().length === 0) throw new TypeError("Agency SQL overlay is empty");
    return sql;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function requireCachedImages(signal: AbortSignal): Promise<ContainerRuntimeClient> {
  signal.throwIfAborted();
  const runtime = await getContainerRuntimeClient();
  signal.throwIfAborted();
  // Ryuk's installed factory uses its default cached policy; it exposes no per-reaper policy setter.
  for (const image of [PG_IMAGE, getReaperImage()]) {
    if (!(await runtime.image.exists(ImageName.fromString(image)))) {
      throw new TypeError(`Required test image is not cached: ${image}`);
    }
    signal.throwIfAborted();
  }
  return runtime;
}

async function removeFailedStart(runtime: ContainerRuntimeClient, id: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const owned = runtime.container.getById(id);
  try {
    await runtime.container.stop(owned, { timeout: 10_000 });
    signal.throwIfAborted();
    await runtime.container.remove(owned, { removeVolumes: true });
    signal.throwIfAborted();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 404
    )
      return;
    throw error;
  }
}

async function awaitCleanup(work: Promise<unknown>[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error || reason instanceof DOMException
          ? reason
          : new Error("Agency fixture cleanup interrupted", { cause: reason }),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    const results = await Promise.race([Promise.allSettled(work), interrupted]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0)
      throw new AggregateError(failures, "Agency fixture cleanup incomplete");
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function setupWithFixture(
  project: TestProject,
  source: AgencyFixtureSource,
): Promise<() => Promise<void>> {
  const signal = AbortSignal.timeout(120_000);
  const { base: verifiedBase, manifest } = await source.verify(signal); // Must fail before starting any container.
  const overlay = await readOverlay(signal);
  const runtime = await requireCachedImages(signal);
  const prepared = new OwnedPostgreSqlContainer(PG_IMAGE)
    .withName(`agency-project-persistence-${randomUUID()}`)
    .withPullPolicy(PullPolicy.neverPull())
    .withStartupTimeout(60_000)
    .withCommand([
      "postgres",
      "-c",
      "max_connections=40",
      "-c",
      "fsync=off",
      "-c",
      "full_page_writes=off",
    ]);
  let container: StartedPostgreSqlContainer | undefined;
  let admin: Pool | undefined;
  let template: Pool | undefined;
  const cleanup = async (cleanupSignal: AbortSignal): Promise<void> => {
    const work: Promise<unknown>[] = [];
    if (admin !== undefined) work.push(admin.end());
    if (template !== undefined) work.push(template.end());
    if (container !== undefined)
      work.push(container.stop({ timeout: 10_000, remove: true, removeVolumes: true }));
    else if (prepared.createdId !== null)
      work.push(removeFailedStart(runtime, prepared.createdId, cleanupSignal));
    // Never stop or sweep the possibly shared Ryuk container/session.
    await awaitCleanup(work, cleanupSignal);
  };
  try {
    container = await prepared.start();
    signal.throwIfAborted();
    console.warn(
      JSON.stringify({
        fixture: "agency-persistence",
        containerId: container.getId(),
        sourceHead: manifest.sourceHead,
        lastTag: manifest.expectedLastTag,
        agencySqlPresent: overlay !== null,
      }),
    );
    const base = {
      host: container.getHost(),
      port: container.getPort(),
      user: container.getUsername(),
      password: container.getPassword(),
    };
    const options = {
      ...base,
      max: 2,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 20_000,
      query_timeout: 25_000,
      idleTimeoutMillis: 3_000,
    };
    admin = new Pool({ ...options, database: container.getDatabase() });
    await admin.query(`CREATE DATABASE ${TEMPLATE}`);
    signal.throwIfAborted();
    await admin.end();
    admin = undefined;
    template = new Pool({ ...options, database: TEMPLATE });
    await template.query(
      "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext",
    );
    await source.verify(signal);
    await migrate(drizzle(template), { migrationsFolder: resolve(verifiedBase, "drizzle") });
    signal.throwIfAborted();
    // A private SQL overlay only, with no canonical journal append or fabricated migration receipt.
    if (overlay !== null) await template.query(overlay);
    signal.throwIfAborted();
    await template.end();
    template = undefined;
    const connection: TestPgConnection = {
      ...base,
      adminDatabase: container.getDatabase(),
      template: TEMPLATE,
    };
    project.provide("testPg", connection);
    console.warn(
      JSON.stringify({
        fixture: "agency-persistence",
        containerId: container.getId(),
        phase: "template-ready",
        sourceHead: manifest.sourceHead,
        agencySqlApplied: overlay !== null,
      }),
    );
    return () => cleanup(AbortSignal.timeout(15_000));
  } catch (error) {
    try {
      await cleanup(AbortSignal.timeout(15_000));
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Agency fixture setup and cleanup failed");
    }
    throw error;
  }
}

// One lifecycle for source-owned descriptors; no environment/path/verifier mix-and-match.
export function createAgencyPersistenceSetup(source: AgencyFixtureSource) {
  return function setup(project: TestProject): Promise<() => Promise<void>> {
    return setupWithFixture(project, source);
  };
}

export default createAgencyPersistenceSetup(legacyFixtureSource);
