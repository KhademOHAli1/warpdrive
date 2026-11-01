import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { prepareNotificationEmail } from "@/features/notifications/email/notificationBinding";
import {
  insertJobNotification,
  notificationJobTransport,
  seedNotificationDeal,
} from "@/features/notifications/email/notificationJob.test-helpers";
import { setPreference } from "@/features/notifications/preferences";
import type { AuthUser } from "@/features/permissions/types";
import { listArchivedThreads, listSentThreads } from "./folderReads";
import { listInbox } from "./inboxList";
import { readMailboxWorkspace } from "./mailboxWorkspace";
import { storeNotificationGmailCopy } from "./notificationGmailCopy";
import { processSendAttempt } from "./outbox";
import { privateProjectionActor } from "./privateIntakeProjection.test-helpers";
import { reviewPrivateIntake } from "./privateIntakeReview";
import {
  seedNativePrivateReview,
  seedNativePrivateReviewMailbox,
} from "./privateIntakeReview.test-helpers";
import { seedPrivateIntake } from "./privateIntakeSchema.test-helpers";
import { searchInbox } from "./searchInbox";

export type PrivateProjectionSurface = "inbox" | "search" | "sent" | "archive" | "workspace";

// Observe real Drizzle statements without substituting the pool or any database response.
export async function readPrivateProjectionSurface(
  db: Db,
  actor: AuthUser,
  surface: PrivateProjectionSurface,
  signal: AbortSignal,
  workspace: { folder?: "inbox" | "sent" | "archive"; query?: string } = {},
) {
  const queries: string[] = [];
  const observed = drizzle((db as Db & { $client: Pool }).$client, {
    schema,
    logger: {
      logQuery(query) {
        queries.push(query);
      },
    },
  });
  const rows =
    surface === "workspace"
      ? (await readMailboxWorkspace(observed, { actor, folder: "inbox", ...workspace }, signal))
          .threads
      : surface === "inbox"
        ? (await listInbox(observed, { actor, filter: "all" }, signal)).threads
        : surface === "search"
          ? await searchInbox(observed, { actor, q: "" }, signal)
          : surface === "sent"
            ? (await listSentThreads(observed, actor, signal)).threads
            : (await listArchivedThreads(observed, actor, signal)).threads;
  return { rows, transactions: queries.filter((query) => /^begin\b/i.test(query)).length };
}

export async function seedPrivateSurfaceBatch(db: Db, signal: AbortSignal) {
  const first = await seedNativePrivateReview(db, signal);
  const second = await seedPrivateIntake(db, signal, { accountId: first.accountId });
  expect(
    await reviewPrivateIntake(
      db,
      first.owner.context,
      { ...first.input, intakeId: second.id, decision: "dismiss" },
      signal,
    ),
  ).toMatchObject({ ok: true, value: { revision: 1 } });
  await db.execute(
    sql`UPDATE email_private_intake SET intake_state='conflict',revision=revision+1 WHERE id=${second.id}`,
  );
  return { first, second, actor: privateProjectionActor(first.ownerId) };
}

export async function seedCanonicalPrivateSurface(db: Db, signal: AbortSignal) {
  const { owner, account } = await seedNativePrivateReviewMailbox(db, signal);
  const dealId = await seedNotificationDeal(db, owner.user.id, "all", signal);
  await db.execute(sql`UPDATE email_accounts SET is_default=true WHERE id=${account.id}`);
  await setPreference(db, owner.user.id, "deal_won", { inApp: true, email: true }, signal);
  const notification = await insertJobNotification(
    db,
    {
      userId: owner.user.id,
      type: "deal_won",
      entityType: "deal",
      entityId: dealId,
      payload: {},
    },
    signal,
  );
  expect(
    await prepareNotificationEmail(db, { notificationId: notification.id, signal }),
  ).toMatchObject({ ok: true, value: { status: "prepared" } });
  const transport = notificationJobTransport();
  expect(
    await processSendAttempt(db, {
      accountId: account.id,
      idempotencyKey: notification.id,
      gmail: transport.gmail,
      storage: transport.deps.storage,
      signal,
    }),
  ).toMatchObject({ ok: true, value: { status: "sent" } });
  expect(transport.gmail.raw).toHaveLength(1);
  const remote = transport.gmail.messages.get("sent-1");
  const [receipt] = await db
    .select({ id: schema.emailSendAttempts.id, sentAt: schema.emailSendAttempts.sentAt })
    .from(schema.emailSendAttempts)
    .where(
      and(
        eq(schema.emailSendAttempts.accountId, account.id),
        eq(schema.emailSendAttempts.idempotencyKey, notification.id),
      ),
    );
  signal.throwIfAborted();
  if (remote === undefined || !(receipt?.sentAt instanceof Date))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Surface fixture actual ACK timestamp missing");
  // This provider Date is present before observation and canonical hashing. No held baseline is edited.
  const observed = {
    ...remote,
    payload: {
      ...remote.payload,
      headers: [
        ...(remote.payload?.headers ?? []),
        { name: "Date", value: receipt.sentAt.toUTCString() },
      ],
    },
  };
  transport.gmail.messages.set(remote.id, observed);
  const intake = await seedPrivateIntake(db, signal, {
    accountId: account.id,
    observedId: remote.id,
    remote: observed,
  });
  const input = {
    accountId: account.id,
    intakeId: intake.id,
    expectedRevision: 0,
    decision: "dismiss" as const,
  };
  expect(await reviewPrivateIntake(db, owner.context, input, signal)).toMatchObject({
    ok: true,
    value: { revision: 1 },
  });
  expect(
    await storeNotificationGmailCopy(db, {
      accountId: account.id,
      idempotencyKey: notification.id,
      gmailMessageId: remote.id,
      signal,
    }),
  ).toEqual({ ok: true, value: undefined });
  const promoted = await db
    .select({
      id: schema.emailMessages.id,
      direction: schema.emailMessages.direction,
      sentAt: schema.emailMessages.sentAt,
    })
    .from(schema.emailMessages)
    .where(
      and(
        eq(schema.emailMessages.id, intake.messageId),
        eq(schema.emailMessages.accountId, account.id),
      ),
    );
  signal.throwIfAborted();
  expect(promoted).toHaveLength(1);
  expect(promoted[0]).toMatchObject({ id: intake.messageId, direction: "outbound" });
  expect(promoted[0]?.sentAt).toBeInstanceOf(Date);
  return {
    ...intake,
    owner,
    account,
    input,
    transport,
    attemptId: receipt.id,
    summary: {
      id: intake.id,
      revision: 2,
      state: "confirmed_notification",
      contentState: "retained",
      decision: "dismiss",
    } as const,
    actor: privateProjectionActor(owner.user.id),
  };
}
