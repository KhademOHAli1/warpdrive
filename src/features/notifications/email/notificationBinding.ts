import { eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { notifications } from "@/db/schema";
import { enqueueSend } from "@/features/email/outbox";
import { err, ok } from "@/types/result";
import {
  existingNotificationBinding,
  notificationBindingRows,
  notificationBindingSuppressed,
  notificationMailbox,
} from "./notificationBindingRows";
import { notificationSnapshot } from "./notificationBindingSnapshot";
import type {
  NotificationEmailInput,
  NotificationPreparation,
  PreparedNotificationEmail,
} from "./notificationEmailTypes";

export async function prepareNotificationEmail(
  db: Db,
  input: NotificationEmailInput,
): Promise<NotificationPreparation> {
  const { signal } = input;
  signal.throwIfAborted();
  try {
    const [pointer] = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.id, input.notificationId))
      .limit(1);
    signal.throwIfAborted();
    let recipientId = pointer?.userId;
    if (recipientId === undefined) {
      const rows = await notificationBindingRows(db, input.notificationId, null, signal, false);
      const prior = existingNotificationBinding(rows, input.notificationId, null);
      if (!prior.ok) return prior;
      recipientId = prior.value?.recipientUserId;
      if (recipientId === undefined) return ok({ status: "skipped", reason: "missing" });
    }
    const ownerId = recipientId;
    return await db.transaction(
      async (tx) => {
        // The same owner lock serializes default changes and first notification bindings.
        const owner = (
          await tx.execute(sql`SELECT is_active,invited_at FROM users
        WHERE id=${ownerId} FOR NO KEY UPDATE`)
        ).rows[0] as { is_active: boolean; invited_at: unknown } | undefined;
        signal.throwIfAborted();
        const [notice] = await tx
          .select()
          .from(notifications)
          .where(eq(notifications.id, input.notificationId))
          .limit(1)
          .for("update");
        signal.throwIfAborted();
        if (notice !== undefined && notice.userId !== ownerId)
          return err(
            new AppError(ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT, "Notification recipient changed"),
          );
        const rows = await notificationBindingRows(tx, input.notificationId, ownerId, signal, true);
        const prior = existingNotificationBinding(rows, input.notificationId, ownerId);
        if (!prior.ok) return prior;
        if (prior.value !== null) {
          // The existing worker performs durable suppression or receipt repair. Never switch mailboxes.
          return retainedNotification(
            prior.value,
            notice?.emailSentAt,
            notificationBindingSuppressed(rows),
          );
        }
        if (notice === undefined) return ok({ status: "skipped", reason: "missing" } as const);
        if (notice.emailSentAt !== null)
          return ok({ status: "skipped", reason: "accepted" } as const);
        if (owner === undefined || !owner.is_active || owner.invited_at !== null)
          return ok({ status: "skipped", reason: "recipient" } as const);
        const mailbox = await notificationMailbox(tx, ownerId, signal);
        if (mailbox === undefined) return ok({ status: "skipped", reason: "mailbox" } as const);
        const snapshot = await notificationSnapshot(tx, notice, mailbox.email_address, signal);
        if (!("payload" in snapshot)) return ok(snapshot);
        const queued = await enqueueSend(tx, {
          accountId: mailbox.id,
          idempotencyKey: notice.id,
          payload: snapshot.payload,
          threadId: null,
        });
        signal.throwIfAborted();
        if (!queued.ok) return queued;
        const saved = await notificationBindingRows(tx, notice.id, ownerId, signal, true);
        const bound = existingNotificationBinding(saved, notice.id, ownerId);
        if (!bound.ok) return bound;
        if (bound.value === null)
          throw new AppError(ERROR_IDS.DB_INVARIANT, "Notification binding was not recorded");
        return ok(bound.value);
      },
      { isolationLevel: "read committed" },
    );
  } catch (error) {
    signal.throwIfAborted();
    const conflict =
      typeof error === "object" && error !== null && "code" in error && error.code === "23505";
    return err(
      error instanceof AppError
        ? error
        : new AppError(
            conflict ? ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT : ERROR_IDS.DB_WRITE_FAILED,
            "Notification email could not be prepared",
          ),
    );
  }
}

function retainedNotification(
  prior: PreparedNotificationEmail,
  emailSentAt: Date | null | undefined,
  suppressed: boolean,
): NotificationPreparation {
  if (emailSentAt != null) return ok({ status: "skipped", reason: "accepted" });
  return suppressed ? ok({ status: "suppressed", reason: "suppressed" }) : ok(prior);
}
