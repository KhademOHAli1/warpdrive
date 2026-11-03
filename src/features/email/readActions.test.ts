// Native authority cases require the canonical migrated read-intent schema.
// Only next/headers-dependent request context and CSRF are substituted. The db
// singleton is redirected to a real canonical-migrated PostgreSQL clone.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { deals, visibilityGroupMembers, visibilityGroups } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { lockDeliveryObservationSession } from "@/features/email/deliveryObservationAuthority";
import { seedMailHttpSession } from "@/features/email/mailConnectionHttp.test-helpers";
import { hydrateOwner } from "@/features/email/syncCursor";
import type { AuthUser } from "@/features/permissions/types";
import { makeTestDb, type TestDb } from "@/test/db";

const context = vi.hoisted(() => ({
  harness: null as TestDb | null,
  actor: null as AuthUser | null,
  session: null as { userId: string; sessionId: string } | null,
}));
vi.mock("@/db/client", () => ({
  get db() {
    if (context.harness === null)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Native read action database is not bound");
    return context.harness.db;
  },
}));
vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () =>
    Promise.resolve({ actor: context.actor, session: context.session, db: context.harness?.db }),
}));

import { markThreadReadAction, markThreadUnreadAction } from "@/features/email/readActions";
import { prepareThreadReadIntentAction } from "@/features/email/readIntentActions";

function nativeDb() {
  if (context.harness === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Native read action fixture is missing");
  return context.harness.db;
}

async function bind(native: Awaited<ReturnType<typeof seedMailHttpSession>>) {
  const db = nativeDb();
  const signal = AbortSignal.timeout(15_000);
  const actor = await hydrateOwner(db, native.user.id, signal);
  if (!actor.ok) throw actor.error;
  expect(
    await db.transaction((tx) => lockDeliveryObservationSession(tx, native.context, signal)),
  ).toBe(true);
  context.actor = actor.value;
  context.session = { userId: native.user.id, sessionId: native.context.sessionId };
  return actor.value;
}

async function seedSharedDealThread(opts: {
  dealOwnerId: string;
  mailboxOwnerId: string;
  visibilityGroupId?: string;
}) {
  const db = nativeDb();
  const pipeline = await seedPipelineWithStages(db, ["A"]);
  const stage = pipeline.stages[0];
  if (stage === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing native stage");
  const [deal] = await db
    .insert(deals)
    .values({
      title: "Shared read authority",
      pipelineId: pipeline.pipeline.id,
      stageId: stage.id,
      ownerId: opts.dealOwnerId,
      visibilityLevel: opts.visibilityGroupId === undefined ? "owner" : "group",
      visibilityGroupId: opts.visibilityGroupId ?? null,
    })
    .returning({ id: deals.id });
  if (deal === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing native deal");
  const account = (
    await db.execute(sql`INSERT INTO email_accounts
    (user_id,email_address,status,provider) VALUES
    (${opts.mailboxOwnerId},${`${randomUUID()}@example.test`},'connected','gmail') RETURNING id`)
  ).rows[0];
  if (typeof account?.id !== "string")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing native mailbox");
  const thread = (
    await db.execute(sql`INSERT INTO email_threads
    (gmail_thread_id,account_id,subject,last_message_at,visibility,deal_id) VALUES
    (${randomUUID()},${account.id},'Shared authority',clock_timestamp(),'shared',${deal.id})
    RETURNING id`)
  ).rows[0];
  if (typeof thread?.id !== "string")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing native shared thread");
  return thread.id;
}

async function prepare(threadId: string, read: boolean) {
  const result = await prepareThreadReadIntentAction("csrf", { threadId, read });
  expect(result).toMatchObject({
    ok: true,
    value: {
      kind: "created",
      readIntent: {
        threadId,
        desiredRead: read,
        state: "prepared",
      },
    },
  });
  if (!result.ok || result.value.kind !== "created")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Native command was not prepared");
  return result.value.readIntent.operationId;
}

async function execute(threadId: string, read: boolean) {
  const operationId = await prepare(threadId, read);
  const action = read ? markThreadReadAction : markThreadUnreadAction;
  const result = await action("csrf", { threadId, operationId });
  expect(result).toMatchObject({
    ok: true,
    value: {
      threadId,
      readIntent: {
        operationId,
        threadId,
        desiredRead: read,
        state: "applied",
      },
    },
  });
}

async function markers(threadId: string) {
  return (
    await nativeDb().execute(sql`SELECT user_id,read_at::text FROM email_thread_reads
    WHERE thread_id=${threadId} ORDER BY user_id`)
  ).rows;
}

describe("readActions actor visibility", () => {
  beforeEach(async () => {
    context.harness = await makeTestDb();
  });
  afterEach(async () => {
    const harness = context.harness;
    context.harness = null;
    context.actor = null;
    context.session = null;
    await harness?.close();
    vi.clearAllMocks();
  });

  it("lets an admin (not the mailbox owner, not the deal owner) mark a shared thread read", async () => {
    const db = nativeDb();
    const mailboxOwner = await seedUser(db);
    const dealOwner = await seedUser(db);
    const admin = await seedMailHttpSession(db, {
      isAdmin: true,
      twoFactorEnabled: true,
      assurance: "mfa",
      mfaAt: new Date(),
    });
    const threadId = await seedSharedDealThread({
      dealOwnerId: dealOwner.id,
      mailboxOwnerId: mailboxOwner.id,
    });
    const actor = await bind(admin);
    expect(actor.type).toBe("admin");
    await execute(threadId, true);
    expect(await markers(threadId)).toMatchObject([{ user_id: admin.user.id }]);
  });

  it("lets a visibility-group member (not owner, not admin) mark a shared thread unread", async () => {
    const db = nativeDb();
    const mailboxOwner = await seedUser(db);
    const dealOwner = await seedUser(db);
    const member = await seedMailHttpSession(db);
    const groupId = randomUUID();
    await db.insert(visibilityGroups).values({ id: groupId, name: "Persisted read authority" });
    await db.insert(visibilityGroupMembers).values({ groupId, userId: member.user.id });
    const threadId = await seedSharedDealThread({
      dealOwnerId: dealOwner.id,
      mailboxOwnerId: mailboxOwner.id,
      visibilityGroupId: groupId,
    });
    const actor = await bind(member);
    expect(actor.type).toBe("regular");
    expect(actor.groupIds.has(groupId)).toBe(true);
    await execute(threadId, true);
    expect(await markers(threadId)).toMatchObject([{ user_id: member.user.id }]);
    await execute(threadId, false);
    expect(await markers(threadId)).toEqual([]);
  });

  it("still rejects a stranger who cannot see the thread via ownership, admin, or group", async () => {
    const db = nativeDb();
    const mailboxOwner = await seedMailHttpSession(db);
    const dealOwner = await seedUser(db);
    const stranger = await seedMailHttpSession(db);
    const threadId = await seedSharedDealThread({
      dealOwnerId: dealOwner.id,
      mailboxOwnerId: mailboxOwner.user.id,
    });
    await bind(mailboxOwner);
    const operationId = await prepare(threadId, true);
    const receipts = () =>
      db.execute(sql`SELECT to_jsonb(i) AS receipt FROM email_read_intents i
      WHERE thread_id=${threadId} ORDER BY actor_id,operation_id`);
    const before = (await receipts()).rows;
    await bind(stranger);
    const missing = { ok: false, error: { id: ERROR_IDS.GMAIL_THREAD_NOT_FOUND } };
    expect(await prepareThreadReadIntentAction("csrf", { threadId, read: true })).toEqual(missing);
    expect(await markThreadReadAction("csrf", { threadId, operationId })).toEqual(missing);
    expect(await markers(threadId)).toEqual([]);
    expect((await receipts()).rows).toEqual(before);
  });
});
