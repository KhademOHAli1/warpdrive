import type { Notification } from "@/db/schema";
import type { SendPayload } from "@/features/email/outboxClaim";
import { canActorAccessParent } from "@/features/files/fileAuthz";
import { resolveAccountLocalePreferences } from "@/features/i18n/accountPreferences";
import { getPreferences } from "@/features/identity/preferencesRepo";
import { hydrateActor } from "@/server/hydrateActor";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { NotificationRow } from "@/types/notification";
import { resolveDelivery } from "../preferences";
import type { NotificationEmailSkip } from "./notificationEmailTypes";
import { renderNotificationEmail } from "./render";

export async function notificationSnapshot(
  db: DbOrTx,
  notification: Notification,
  address: string,
  signal: AbortSignal,
): Promise<{ payload: SendPayload } | NotificationEmailSkip> {
  const recipient = await hydrateActor(db, notification.userId, signal);
  if (recipient === null) return { status: "skipped", reason: "recipient" };
  if (notification.entityType !== null && notification.entityId !== null) {
    const visible = await canActorAccessParent(
      db,
      recipient,
      notification.entityType,
      notification.entityId,
      signal,
    );
    signal.throwIfAborted();
    if (visible !== true) return { status: "skipped", reason: "visibility" };
  }
  const delivery = await resolveDelivery(db, notification.userId, notification.type, signal);
  signal.throwIfAborted();
  if (!delivery.email) return { status: "skipped", reason: "preference" };
  const preferences = await getPreferences(db, notification.userId, signal);
  signal.throwIfAborted();
  const { locale } = resolveAccountLocalePreferences({
    saved: preferences.ui.localePreferences,
    profileTimeZone: preferences.timezone,
  });
  const row: NotificationRow = {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    entityType: notification.entityType,
    entityId: notification.entityId,
    actorId: notification.actorId,
    payload: notification.payload,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
  const rendered = renderNotificationEmail(row, recipient.name, locale);
  return {
    payload: {
      to: [address],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      visibility: "private",
      linkPersonId: null,
      linkDealId: null,
      trackOpens: false,
      trackLinks: false,
      systemPurpose: {
        version: 1,
        kind: "notification",
        notificationId: notification.id,
        recipientUserId: notification.userId,
      },
    },
  };
}
