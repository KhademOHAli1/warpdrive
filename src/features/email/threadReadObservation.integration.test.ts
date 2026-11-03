import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { AuthUser } from "@/features/permissions/types";
import { getThread } from "./emailReads";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
const signal = () => AbortSignal.timeout(8000);
const actorOf = (id: string): AuthUser => ({
  id,
  type: "regular",
  isActive: true,
  groupIds: new Set(),
});

async function seedThread(db: TestDb, ownerId: string) {
  const [account] = (
    await db.execute(sql`INSERT INTO email_accounts (user_id,email_address,status)
      VALUES (${ownerId},${`${ownerId}@example.test`},'connected') RETURNING id`)
  ).rows as { id: string }[];
  if (account === undefined) throw new Error("account fixture was not created");
  const [thread] = (
    await db.execute(sql`INSERT INTO email_threads
      (account_id,gmail_thread_id,subject,last_message_at,visibility)
      VALUES (${account.id},'read-observation','Read observation',now(),'private')
      RETURNING id`)
  ).rows as { id: string }[];
  if (thread === undefined) throw new Error("thread fixture was not created");
  return thread.id;
}

it.each([
  { marker: "absent", unread: true },
  { marker: "current", unread: false },
  { marker: "stale", unread: true },
  { marker: "newer-message", unread: true },
] as const)("fresh thread reads project the actor's $marker marker", async ({ marker, unread }) => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const threadId = await seedThread(db, owner.id);
    if (marker !== "absent") {
      await db.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
        SELECT id,${owner.id},
          CASE WHEN ${marker}='stale' THEN last_message_at-interval '1 second'
            ELSE last_message_at END
        FROM email_threads WHERE id=${threadId}`);
    }
    if (marker === "newer-message")
      await db.execute(sql`UPDATE email_threads
        SET last_message_at=last_message_at+interval '1 hour' WHERE id=${threadId}`);

    const result = await getThread(
      db,
      { actor: actorOf(owner.id), threadId, allowRemote: false },
      signal(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.thread.unread).toBe(unread);
  });
});

it("does not borrow the owner's read marker for a visible shared-thread reader", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const viewer = await seedUser(db);
    const threadId = await seedThread(db, owner.id);
    const [person] = (
      await db.execute(sql`INSERT INTO persons (name,owner_id,visibility_level)
        VALUES ('Shared read observation',${owner.id},'all') RETURNING id`)
    ).rows as { id: string }[];
    if (person === undefined) throw new Error("person fixture was not created");
    await db.execute(sql`UPDATE email_threads SET visibility='shared',person_id=${person.id}
      WHERE id=${threadId}`);
    await db.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
      SELECT id,${owner.id},last_message_at FROM email_threads WHERE id=${threadId}`);

    const result = await getThread(
      db,
      { actor: actorOf(viewer.id), threadId, allowRemote: false },
      signal(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.thread.unread).toBe(true);
  });
});

it("keeps read observations hidden with an invisible private thread", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const stranger = await seedUser(db);
    const threadId = await seedThread(db, owner.id);
    expect(
      await getThread(db, { actor: actorOf(stranger.id), threadId, allowRemote: false }, signal()),
    ).toMatchObject({ ok: false, error: { id: "E_GMAIL_011" } });
  });
});

it.each([false, true])("projects an undated thread with marker=%s", async (hasMarker) => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const threadId = await seedThread(db, owner.id);
    await db.execute(sql`UPDATE email_threads SET last_message_at=NULL WHERE id=${threadId}`);
    if (hasMarker) {
      await db.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id)
        VALUES (${threadId},${owner.id})`);
    }

    const result = await getThread(
      db,
      { actor: actorOf(owner.id), threadId, allowRemote: false },
      signal(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.thread.unread).toBe(!hasMarker);
  });
});

it.each([
  { offset: -1, unread: true },
  { offset: 0, unread: false },
  { offset: 1, unread: false },
])("compares the $offset microsecond watermark in PostgreSQL", async ({ offset, unread }) => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const threadId = await seedThread(db, owner.id);
    await db.execute(sql`UPDATE email_threads
      SET last_message_at='2026-11-03 01:02:03.456789+00'::timestamptz WHERE id=${threadId}`);
    await db.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
      SELECT id,${owner.id},last_message_at+${offset}::integer*interval '1 microsecond'
      FROM email_threads WHERE id=${threadId}`);

    const result = await getThread(
      db,
      { actor: actorOf(owner.id), threadId, allowRemote: false },
      signal(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.thread.unread).toBe(unread);
  });
});
