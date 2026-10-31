import { sql } from "drizzle-orm";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, expect, inject, test } from "vitest";
import { makeTestDb } from "./db";

let h: Awaited<ReturnType<typeof makeTestDb>>;

beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("harness gives a live Postgres with required extensions", async () => {
  const ext = await h.db.execute(
    sql`SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','citext') ORDER BY extname`,
  );
  const names = ext.rows.map((r) => (r as { extname: string }).extname);
  expect(names).toEqual(["citext", "pgcrypto"]);
});

function adminConnection() {
  const pg = inject("testPg");
  return new Pool({
    host: pg.host,
    port: pg.port,
    user: pg.user,
    password: pg.password,
    database: pg.adminDatabase,
    max: 1,
  });
}

test("closing a clone reclaims its database and can safely be repeated", async () => {
  const clone = await makeTestDb();
  const name = new URL(clone.url).pathname.slice(1);
  const admin = adminConnection();
  try {
    await clone.close();
    await clone.close();
    const result = await admin.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT FROM pg_database WHERE datname=$1) AS present",
      [name],
    );
    expect(result.rows[0]?.present).toBe(false);
  } finally {
    await admin.end();
  }
});

test("closing retains a database with an external listener and never force-terminates that client", async () => {
  const clone = await makeTestDb();
  const external = new Client({ connectionString: clone.url });
  await external.connect();
  try {
    await external.query("LISTEN harness_external_notice");
    await clone.close();
    await clone.close();
    const result = await external.query<{ alive: number }>("SELECT 1 AS alive");
    expect(result.rows[0]?.alive).toBe(1);
    const notice = new Promise<string | undefined>((resolve) => {
      external.once("notification", (message) => resolve(message.payload));
    });
    await external.query("NOTIFY harness_external_notice, 'still-listening'");
    expect(await notice).toBe("still-listening");
  } finally {
    await external.end();
  }
});

test("database disposal errors other than a live external connection are propagated", async () => {
  const clone = await makeTestDb();
  const name = new URL(clone.url).pathname.slice(1);
  const renamed = `${name}_renamed`;
  const admin = adminConnection();
  try {
    await admin.query(`ALTER DATABASE "${name}" RENAME TO "${renamed}"`);
    await expect(clone.close()).rejects.toMatchObject({ code: "3D000" });
  } finally {
    await admin.query(`DROP DATABASE "${renamed}"`);
    await admin.end();
  }
});
