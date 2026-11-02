import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import {
  appendPrivateIntakeSchemaReview,
  expectPrivateIntakePgError,
  privateIntakeRow,
  seedPrivateIntake,
} from "./privateIntakeSchema.test-helpers";

// This is a structural RED gate. It does not claim that privacy, authenticated
// review, confirmation, retention or replay behavior has been exercised.
it("[structural] provides provider-neutral private intake and separate review history", async () => {
  await withTestDb(async (db) => {
    const row = (
      await db.execute(sql`SELECT
        to_regclass('public.email_private_intake') IS NOT NULL AS intake,
        to_regclass('public.email_private_intake_reviews') IS NOT NULL AS reviews`)
    ).rows[0];
    expect(row).toEqual({ intake: true, reviews: true });
    const statuses = (
      await db.execute(sql`SELECT enumlabel FROM pg_enum
        JOIN pg_type ON pg_enum.enumtypid=pg_type.oid
        WHERE typname='email_send_status' ORDER BY enumsortorder`)
    ).rows.map((entry) => entry.enumlabel);
    expect(statuses).toEqual(["pending", "sending", "sent", "failed", "needs_review"]);
  });
});

it("[schema behavior] appends reviews at the advanced ledger revision and rejects history rewrites", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const before = await privateIntakeRow(db, f.id, signal);
    expect(
      await appendPrivateIntakeSchemaReview(db, {
        intakeId: f.id,
        accountId: f.accountId,
        actorId: f.ownerId,
        expectedRevision: 0,
        decision: "keep_private",
        signal,
      }),
    ).toBe(1);
    expect(await privateIntakeRow(db, f.id, signal)).toEqual({ ...before, revision: 1 });
    const history = async () => {
      const result = await db.execute(sql`SELECT revision,actor_id,decision
        FROM email_private_intake_reviews WHERE intake_id=${f.id} AND account_id=${f.accountId}
        ORDER BY revision`);
      signal.throwIfAborted();
      return result.rows;
    };
    const original = await history();
    expect(original).toEqual([{ revision: 1, actor_id: f.ownerId, decision: "keep_private" }]);
    await expectPrivateIntakePgError(
      db.execute(sql`UPDATE email_private_intake_reviews
      SET decision='dismiss' WHERE intake_id=${f.id} AND revision=1`),
      ["23514"],
      signal,
    );
    await expectPrivateIntakePgError(
      db.execute(sql`DELETE FROM email_private_intake_reviews
      WHERE intake_id=${f.id} AND revision=1`),
      ["23514"],
      signal,
    );
    await expectPrivateIntakePgError(
      db.execute(sql`INSERT INTO email_private_intake_reviews
      (intake_id,account_id,revision,actor_id,decision)
      VALUES(${f.id},${f.accountId},1,${f.ownerId},'dismiss')`),
      ["23505"],
      signal,
    );
    await expectPrivateIntakePgError(
      db.execute(sql`INSERT INTO email_private_intake_reviews
      (intake_id,account_id,revision,actor_id,decision)
      VALUES(${f.id},${f.accountId},0,${f.ownerId},'dismiss')`),
      ["23514"],
      signal,
    );
    await expectPrivateIntakePgError(
      db.execute(sql`INSERT INTO email_private_intake_reviews
      (intake_id,account_id,revision,actor_id,decision)
      VALUES(${f.id},${f.accountId},2,${f.ownerId},'dismiss')`),
      ["23514"],
      signal,
    );
    expect(await history()).toEqual(original);
    expect(await privateIntakeRow(db, f.id, signal)).toEqual({ ...before, revision: 1 });
  });
});

it("[schema behavior] retains the last review across a purge revision gap without granting acceptance", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    await appendPrivateIntakeSchemaReview(db, {
      intakeId: f.id,
      accountId: f.accountId,
      actorId: f.ownerId,
      expectedRevision: 0,
      decision: "keep_private",
      signal,
    });
    await db.execute(
      sql`DELETE FROM email_messages WHERE id=${f.messageId} AND account_id=${f.accountId}`,
    );
    signal.throwIfAborted();
    const purged = await privateIntakeRow(db, f.id, signal);
    expect(purged).toMatchObject({
      revision: 2,
      content_state: "purged",
      owned_message_id: null,
      observed_payload: null,
      confirmation_attempt_id: null,
      confirmation_snapshot: null,
    });
    const latest = async () => {
      const result = await db.execute(sql`SELECT revision,decision FROM email_private_intake_reviews
        WHERE intake_id=${f.id} AND account_id=${f.accountId} ORDER BY revision DESC LIMIT 1`);
      signal.throwIfAborted();
      return result.rows;
    };
    expect(await latest()).toEqual([{ revision: 1, decision: "keep_private" }]);
    // A stale review cannot fill a revision already consumed by content purge.
    await expectPrivateIntakePgError(
      db.execute(sql`INSERT INTO email_private_intake_reviews
      (intake_id,account_id,revision,actor_id,decision)
      VALUES(${f.id},${f.accountId},1,${f.ownerId},'dismiss')`),
      ["23514"],
      signal,
    );
    expect(
      await appendPrivateIntakeSchemaReview(db, {
        intakeId: f.id,
        accountId: f.accountId,
        actorId: f.ownerId,
        expectedRevision: 2,
        decision: "dismiss",
        signal,
      }),
    ).toBe(3);
    expect(await latest()).toEqual([{ revision: 3, decision: "dismiss" }]);
    expect(
      (
        await db.execute(sql`SELECT revision,decision FROM email_private_intake_reviews
      WHERE intake_id=${f.id} ORDER BY revision`)
      ).rows,
    ).toEqual([
      { revision: 1, decision: "keep_private" },
      { revision: 3, decision: "dismiss" },
    ]);
    expect(await privateIntakeRow(db, f.id, signal)).toEqual({ ...purged, revision: 3 });
  });
});

// These require the forward tables. Before DDL their prerequisite assertion is
// still only structural RED; after DDL they exercise actual PostgreSQL behavior.
it("[schema behavior] keys opaque provider IDs per account without case folding", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal, { observedId: "Opaque-Provider-ID" });
    await expectPrivateIntakePgError(
      seedPrivateIntake(db, signal, {
        accountId: f.accountId,
        observedId: f.observedId,
      }),
      ["23505"],
      signal,
    );
    const differentCase = await seedPrivateIntake(db, signal, {
      accountId: f.accountId,
      observedId: "opaque-provider-id",
    });
    const anotherMailbox = await seedPrivateIntake(db, signal, { observedId: f.observedId });
    expect(differentCase.id).not.toBe(f.id);
    expect(anotherMailbox.accountId).not.toBe(f.accountId);
    expect((await db.execute(sql`SELECT id FROM email_private_intake`)).rows).toHaveLength(3);
    expect((await privateIntakeRow(db, f.id, signal))?.confirmation_attempt_id).toBeNull();
    expect((await privateIntakeRow(db, f.id, signal))?.confirmation_snapshot).toBeNull();
  });
});

it("[schema behavior] rejects foreign owned copies and declares account-scoped parent references", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const other = await seedPrivateIntake(db, signal);
    const before = await privateIntakeRow(db, f.id, signal);
    await expectPrivateIntakePgError(
      seedPrivateIntake(db, signal, {
        accountId: f.accountId,
        ownedMessageIdOverride: other.messageId,
      }),
      ["23503", "23514"],
      signal,
    );
    expect(await privateIntakeRow(db, f.id, signal)).toEqual(before);
    const foreignKeys = (
      await db.execute(sql`SELECT
      c.conrelid::regclass::text AS child_table,c.confrelid::regclass::text AS parent_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS child_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS parent_columns
      FROM pg_constraint c WHERE c.contype='f' AND c.conrelid IN
        ('email_private_intake'::regclass,'email_private_intake_reviews'::regclass)`)
    ).rows;
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          child_table: "email_private_intake",
          parent_table: "email_messages",
          child_columns: ["owned_message_id", "account_id"],
          parent_columns: ["id", "account_id"],
        }),
        expect.objectContaining({
          child_table: "email_private_intake",
          parent_table: "email_send_attempts",
          child_columns: ["confirmation_attempt_id", "account_id"],
          parent_columns: ["id", "account_id"],
        }),
        expect.objectContaining({
          child_table: "email_private_intake_reviews",
          parent_table: "email_private_intake",
          child_columns: ["intake_id", "account_id"],
          parent_columns: ["id", "account_id"],
        }),
      ]),
    );
  });
});

it("[schema behavior] rejects evidence and baseline edits even with a new revision", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const before = await privateIntakeRow(db, f.id, signal);
    const changes = [
      sql`observed_provider_id='forged-observation'`,
      sql`observed_payload='{"changed":"owner data"}'::jsonb`,
      sql`observed_payload_hash=${"a".repeat(64)}`,
      sql`baseline_message_hash=${"b".repeat(64)}`,
      sql`baseline_thread_hash=${"c".repeat(64)}`,
      sql`baseline_attachments_hash=${"d".repeat(64)}`,
      sql`baseline_thread_id=gen_random_uuid()`,
    ];
    for (const change of changes)
      await expectPrivateIntakePgError(
        db.execute(sql`UPDATE email_private_intake
        SET ${change},revision=revision+1 WHERE id=${f.id}`),
        ["23514"],
        signal,
      );
    expect(await privateIntakeRow(db, f.id, signal)).toEqual(before);
  });
});

it("[schema behavior] rejects public-hint confirmation and nulling retained copy references", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const before = await privateIntakeRow(db, f.id, signal);
    await expectPrivateIntakePgError(
      db.execute(sql`UPDATE email_private_intake
      SET confirmation_snapshot=jsonb_build_object('version',1,'accountId',account_id::text,
        'providerMessageId',observed_provider_id,'evidence','public_header'),
        intake_state='confirmed_notification',revision=revision+1 WHERE id=${f.id}`),
      ["23514"],
      signal,
    );
    await expectPrivateIntakePgError(
      db.execute(sql`UPDATE email_private_intake
      SET owned_message_id=NULL,revision=revision+1 WHERE id=${f.id}`),
      ["23514"],
      signal,
    );
    await expectPrivateIntakePgError(
      db.execute(sql`DELETE FROM email_private_intake
      WHERE id=${f.id}`),
      ["23514"],
      signal,
    );
    expect(await privateIntakeRow(db, f.id, signal)).toEqual(before);
  });
});

it("[schema behavior] removes duplicated payload on parent-copy purge and keeps a replay tombstone", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const before = await privateIntakeRow(db, f.id, signal);
    const deleted = await db.execute(sql`DELETE FROM email_messages WHERE id=${f.messageId}
      AND account_id=${f.accountId} RETURNING id`);
    expect(deleted.rows).toHaveLength(1);
    const purged = await privateIntakeRow(db, f.id, signal);
    expect(purged).toEqual({
      ...before,
      owned_message_id: null,
      observed_payload: null,
      content_state: "purged",
      revision: 1,
    });
    // baseline_thread_id is a snapshot, not a second lifecycle FK. Its surviving
    // private thread must not prevent one-way message cleanup.
    expect(
      (await db.execute(sql`SELECT id FROM email_threads WHERE id=${f.threadId}`)).rows,
    ).toHaveLength(1);
    await expectPrivateIntakePgError(
      seedPrivateIntake(db, signal, {
        accountId: f.accountId,
        observedId: f.observedId,
      }),
      ["23505"],
      signal,
    );
    await expectPrivateIntakePgError(
      db.execute(sql`UPDATE email_private_intake
      SET observed_payload=${JSON.stringify(f.remote)}::jsonb,content_state='retained',
        revision=revision+1 WHERE id=${f.id}`),
      ["23514"],
      signal,
    );
    expect(await privateIntakeRow(db, f.id, signal)).toEqual(purged);
  });
});
