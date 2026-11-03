// Canonical migrated read-intent fixtures; this helper registers no test cases.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
type Executor = Pick<TestDb, "execute">;
interface Scope {
  actorId: string;
  accountId: string;
  threadId: string;
}
// Assert the real canonical migration was applied by the ordinary shared template.
// SQL is read for its ledger checksum only; no private DDL is executed here.
export async function assertReadIntentSchema(db: Executor): Promise<void> {
  const journal = JSON.parse(
    await readFile(new URL("../../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: { idx: number; tag: string; when: number }[] };
  expect(journal.entries.slice(0, 104).map((entry) => entry.idx)).toEqual(
    Array.from({ length: 104 }, (_, index) => index),
  );
  const migration = journal.entries[103];
  if (migration === undefined || !migration.tag.startsWith("0103_"))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Canonical 0103 read-intent migration is required");
  const canonicalSql = await readFile(
    new URL(`../../../drizzle/${migration.tag}.sql`, import.meta.url),
    "utf8",
  );
  const expectedHash = createHash("sha256").update(canonicalSql).digest("hex");
  expect(
    (
      await db.execute(sql`SELECT hash FROM drizzle.__drizzle_migrations
    WHERE created_at=${migration.when}`)
    ).rows,
  ).toEqual([{ hash: expectedHash }]);
  expect(
    (
      await db.execute(sql`SELECT count(*)::integer AS count
    FROM drizzle.__drizzle_migrations`)
    ).rows,
  ).toEqual([{ count: journal.entries.length }]);
  const columns = (
    await db.execute(sql`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='email_read_intents'
    ORDER BY ordinal_position`)
  ).rows.map((row) => row.column_name);
  expect(columns).toEqual([
    "actor_id",
    "operation_id",
    "account_id",
    "thread_id",
    "mailbox_owner_id",
    "account_provider",
    "connection_generation",
    "private_copy",
    "desired_read",
    "read_mode",
    "state",
    "created_at",
    "admit_before",
    "admitted_at",
    "terminal_at",
    "dispatch_claim",
    "error_id",
  ]);
}

export async function withIntentDb(check: (db: TestDb, scope: Scope) => Promise<void>) {
  await withTestDb(async (db) => {
    await assertReadIntentSchema(db);
    const actor = await seedUser(db);
    const account = (
      await db.execute(sql`INSERT INTO email_accounts (user_id,email_address,status)
      VALUES (${actor.id},${`${actor.id}@example.test`},'connected') RETURNING id`)
    ).rows[0];
    if (typeof account?.id !== "string")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "account fixture missing");
    const thread = (
      await db.execute(sql`INSERT INTO email_threads
      (account_id,gmail_thread_id,subject,last_message_at,visibility)
      VALUES (${account.id},'read-intent-constraint','Read intent constraint',now(),'private')
      RETURNING id`)
    ).rows[0];
    if (typeof thread?.id !== "string")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "thread fixture missing");
    await check(db, { actorId: actor.id, accountId: account.id, threadId: thread.id });
  });
}

export async function prepare(
  db: Executor,
  f: Scope,
  options: {
    operationId?: string;
    expired?: boolean;
    generation?: number;
    accountId?: string;
  } = {},
) {
  const id = options.operationId ?? randomUUID();
  const result = await db.execute(sql`INSERT INTO email_read_intents
    (actor_id,operation_id,account_id,thread_id,mailbox_owner_id,account_provider,
      connection_generation,private_copy,desired_read,read_mode,created_at,admit_before)
    VALUES (${f.actorId},${id},${options.accountId ?? f.accountId},${f.threadId},${f.actorId},'gmail',
      ${options.generation ?? 1},true,true,'local',clock_timestamp()-interval '2 minutes',
      CASE WHEN ${options.expired ?? false} THEN clock_timestamp()-interval '1 minute'
        ELSE clock_timestamp()+interval '1 minute' END)
    ON CONFLICT DO NOTHING RETURNING operation_id`);
  return { id, rows: result.rows };
}

export async function intent(db: Executor, f: Scope, id: string) {
  const row = (
    await db.execute(sql`SELECT state,dispatch_claim,admitted_at,terminal_at,error_id,
    desired_read,connection_generation FROM email_read_intents
    WHERE actor_id=${f.actorId} AND operation_id=${id}`)
  ).rows[0];
  if (row === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "intent fixture missing");
  return row;
}

export async function admit(db: Executor, f: Scope, id: string) {
  const claim = randomUUID();
  await db.execute(sql`UPDATE email_read_intents SET state='admitted',
    dispatch_claim=${claim},admitted_at=clock_timestamp()
    WHERE actor_id=${f.actorId} AND operation_id=${id}`);
  return claim;
}

export async function unknown(db: Executor, f: Scope, id: string) {
  const claim = await admit(db, f, id);
  await db.execute(sql`UPDATE email_read_intents SET state='unknown',error_id='E_DB_003'
    WHERE actor_id=${f.actorId} AND operation_id=${id}`);
  return claim;
}

export async function rejected(work: Promise<unknown>, message: string, code = "23514") {
  let failure: unknown;
  try {
    await work;
  } catch (error) {
    failure = error;
  }
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof failure !== "object" || failure === null) break;
    if ("code" in failure && typeof failure.code === "string") {
      expect(failure.code).toBe(code);
      expect("message" in failure ? failure.message : undefined).toEqual(
        expect.stringContaining(message),
      );
      return;
    }
    failure = "cause" in failure ? failure.cause : undefined;
  }
  expect.fail("Expected the real PostgreSQL constraint rejection");
}
