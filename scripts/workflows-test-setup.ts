import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject) {
  const raw = process.env.WORKFLOW_TEST_DATABASE_URL;
  if (raw === undefined)
    throw new Error("Set WORKFLOW_TEST_DATABASE_URL to a disposable local PostgreSQL instance.");
  const url = new URL(raw);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    decodeURIComponent(url.username) !== "workflow_test"
  )
    throw new Error(
      "Workflow test lane requires a local disposable workflow_test PostgreSQL role.",
    );
  const template = `wf_template_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: raw, max: 2 });
  await admin.query(`CREATE DATABASE "${template}"`);
  const templateUrl = new URL(raw);
  templateUrl.pathname = `/${template}`;
  const pool = new Pool({ connectionString: templateUrl.href, max: 2 });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await pool.query("CREATE EXTENSION IF NOT EXISTS citext");
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
  project.provide("testPg", {
    host: url.hostname,
    port: Number(url.port || "5432"),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    adminDatabase: url.pathname.slice(1),
    template,
  });
  return async () => {
    await admin.query(`DROP DATABASE "${template}" WITH (FORCE)`);
    await admin.end();
  };
}
