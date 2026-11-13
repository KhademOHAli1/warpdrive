/** Provision or read back one explicitly selected local operations source. */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { z } from "zod";
import * as schema from "@/db/schema";
import { operationsSourceBindingSchema } from "@/features/operations/contracts";
import {
  operationsInvariant,
  operationsSourceRoleSchema,
  provisionOperationsSource,
} from "@/features/operations/storage";

const MAXIMUM_CONFIG_BYTES = 4_096;
const configuration = z.strictObject({
  databaseUrl: z.string().min(1).max(2_048),
  role: operationsSourceRoleSchema,
  binding: operationsSourceBindingSchema,
});

function requirePrivateConfiguration(path: string) {
  const parent = dirname(path);
  if (!isAbsolute(path) || realpathSync(path) !== path) {
    operationsInvariant("Canonical private provisioning configuration required");
  }
  const info = lstatSync(parent);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o7777) !== 0o700) {
    operationsInvariant("Owned private provisioning configuration directory required");
  }
}

function readConfiguration(path: string) {
  requirePrivateConfiguration(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.uid !== process.getuid?.() ||
      before.nlink !== 1 ||
      ![0o400, 0o600].includes(before.mode & 0o7777) ||
      before.size === 0 ||
      before.size > MAXIMUM_CONFIG_BYTES
    ) {
      operationsInvariant("Private bounded provisioning configuration required");
    }
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    const after = fstatSync(fd);
    const named = lstatSync(path);
    if (
      offset !== before.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      named.dev !== after.dev ||
      named.ino !== after.ino
    ) {
      operationsInvariant("Provisioning configuration changed");
    }
    const raw: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)),
    );
    return configuration.parse(raw);
  } finally {
    closeSync(fd);
  }
}

function poolOptions(databaseUrl: string): PoolConfig & { user: string; database: string } {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.slice(1));
  const port = Number(url.port);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^[a-z][a-z0-9_]{0,62}$/u.test(user) ||
    !/^[a-z][a-z0-9_]{0,62}$/u.test(database) ||
    password.length === 0 ||
    password.includes("\0")
  ) {
    operationsInvariant("Explicit local provisioning database profile required");
  }
  return {
    host: url.hostname === "[::1]" ? "::1" : url.hostname,
    port,
    user,
    password,
    database,
    ssl: false,
    options: "-c search_path=public,pg_catalog",
    application_name: "warpdrive-operations-source",
    max: 1,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000,
    query_timeout: 7_000,
    lock_timeout: 2_000,
    idle_in_transaction_session_timeout: 10_000,
  };
}

async function provision(path: string) {
  const config = readConfiguration(path);
  const options = poolOptions(config.databaseUrl);
  const pool = new Pool(options);
  pool.on("error", () => console.warn("Operations source database connection held"));
  try {
    const role = await pool.query<{ safe: boolean }>(
      `SELECT current_user = $1 AND session_user = current_user AND current_database() = $2
         AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
         AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = oid)
         AS safe
       FROM pg_catalog.pg_roles WHERE rolname = current_user`,
      [options.user, options.database],
    );
    if (role.rows[0]?.safe !== true)
      operationsInvariant("Restricted provisioning database role required");
    return await provisionOperationsSource(
      drizzle(pool, { schema }),
      { binding: config.binding, role: config.role },
      AbortSignal.timeout(15_000),
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  const [command, path, ...extra] = process.argv.slice(2);
  if (command !== "enroll" || path === undefined || extra.length !== 0) {
    console.error(
      "Usage: bun --no-env-file scripts/operations-source.ts enroll /private/source.json",
    );
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(await provision(path))}\n`);
    } catch {
      console.error(
        "Operations source enrollment held. Keep the exact configuration for readback.",
      );
      process.exitCode = 1;
    }
  }
}
