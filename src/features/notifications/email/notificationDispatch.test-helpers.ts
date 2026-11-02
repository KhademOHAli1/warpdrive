import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { FakeGmailClient } from "@/features/email/gmailFake";
import type { ImapConnectionRuntime } from "@/features/email/mailConnectionRuntime";
import { enqueueSend } from "@/features/email/outbox";
import { createImapTransport } from "@/features/email/providers/imap";
import { createSmtpTransport } from "@/features/email/providers/smtp";
import { FakeStorageClient } from "@/features/files/storageFake";
import type { Locale } from "@/features/i18n/registry";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { startMailProtocolImap } from "@/test/mailProtocolImap";
import { startMailProtocolSmtp } from "@/test/mailProtocolSmtp";
import { ok } from "@/types/result";
import { setPreference } from "../preferences";
import { disposeNotificationResources } from "./notificationPg.test-helpers";

async function acquireNotificationMail(
  db: Db,
  options: Parameters<typeof startMailProtocolSmtp>[0],
) {
  let imap: Awaited<ReturnType<typeof startMailProtocolImap>> | undefined;
  let smtp: Awaited<ReturnType<typeof startMailProtocolSmtp>> | undefined;
  try {
    const owner = await seedUser(db);
    const accountId = randomUUID();
    await db.execute(sql`INSERT INTO email_accounts
      (id,user_id,email_address,provider,connection_settings)
      VALUES (${accountId},${owner.id},'owner@mail.test','imap_smtp','{"sentCopyMode":"crm_only"}'::jsonb)`);
    imap = await startMailProtocolImap();
    smtp = await startMailProtocolSmtp(options);
    const credentials = { username: "owner@mail.test", password: "synthetic-password" };
    const runtime: ImapConnectionRuntime = {
      accountId,
      ownerId: owner.id,
      generation: 1,
      emailAddress: "owner@mail.test",
      historyDays: 90,
      folderPaths: ["INBOX", "Sent"],
      imap: createImapTransport({ ...credentials, endpoint: imap.endpoint }),
      smtp: createSmtpTransport({ ...credentials, endpoint: smtp.endpoint }),
    };
    const storage = new FakeStorageClient();
    const signal = AbortSignal.timeout(60_000);
    const close = () =>
      disposeNotificationResources(
        () => imap?.close() ?? Promise.resolve(),
        () => smtp?.close() ?? Promise.resolve(),
      );
    return { owner, accountId, runtime, storage, smtp, imap, args: { signal }, close };
  } catch (error) {
    await disposeNotificationResources(
      () => imap?.close() ?? Promise.resolve(),
      () => smtp?.close() ?? Promise.resolve(),
    );
    throw error;
  }
}

export async function notificationSmtpFixture(
  db: Db,
  options: Parameters<typeof startMailProtocolSmtp>[0] = {},
) {
  const mail = await acquireNotificationMail(db, options);
  try {
    const other = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (!stage) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Fixture stage missing");
    const [deal] = (
      await db.execute(sql`INSERT INTO deals (title,pipeline_id,stage_id,owner_id,visibility_level)
      VALUES ('Visible fixture',${pipeline.id},${stage.id},${other.id},'all') RETURNING id`)
    ).rows as { id: string }[];
    if (!deal) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Fixture deal missing");
    const [notification] = (
      await db.execute(sql`INSERT INTO notifications
      (user_id,type,entity_type,entity_id,actor_id,payload)
      VALUES (${mail.owner.id},'activity_reminder','deal',${deal.id},${other.id},
        '{"subject":"جلسه / Rückruf <Acme>"}'::jsonb) RETURNING id`)
    ).rows as { id: string }[];
    if (!notification) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Fixture notice missing");
    await db.execute(sql`UPDATE email_accounts SET is_default=true WHERE id=${mail.accountId}`);
    await setPreference(
      db,
      mail.owner.id,
      "activity_reminder",
      { inApp: true, email: true },
      mail.args.signal,
    );
    const runtimes = new Map<string, ImapConnectionRuntime>([[mail.accountId, mail.runtime]]);
    const loadedAccounts: string[] = [];
    const deps = {
      resolveClient: () => {
        throw new AppError(ERROR_IDS.MAIL_CAPABILITY_DENIED, "Notification must not resolve Gmail");
      },
      loadMail: (_db: Db, accountId: string, signal: AbortSignal) => {
        signal.throwIfAborted();
        loadedAccounts.push(accountId);
        const runtime = runtimes.get(accountId);
        if (!runtime)
          throw new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "Fixture mailbox missing");
        return Promise.resolve(ok(runtime));
      },
      storage: mail.storage,
    };
    return {
      ...mail,
      notificationId: notification.id,
      dealId: deal.id,
      other,
      deps,
      runtimes,
      loadedAccounts,
      input: { notificationId: notification.id, signal: mail.args.signal },
      async addSecondMailbox() {
        const id = randomUUID();
        await db.execute(sql`INSERT INTO email_accounts
        (id,user_id,email_address,provider,connection_settings)
        VALUES (${id},${mail.owner.id},'second@mail.test','imap_smtp','{"sentCopyMode":"crm_only"}'::jsonb)`);
        runtimes.set(id, { ...mail.runtime, accountId: id, emailAddress: "second@mail.test" });
        return id;
      },
      async locale(locale: Locale) {
        await setPreferences(
          db,
          mail.owner.id,
          {
            ui: { localePreferences: { locale, calendar: "persian", timeZone: "Asia/Tehran" } },
          },
          mail.args.signal,
        );
      },
      async revoke(kind: "opt_out" | "visibility" | "invited" | "inactive") {
        if (kind === "opt_out")
          await setPreference(
            db,
            mail.owner.id,
            "activity_reminder",
            { inApp: true, email: false },
            mail.args.signal,
          );
        else if (kind === "visibility")
          await db.execute(sql`UPDATE deals SET visibility_level='owner' WHERE id=${deal.id}`);
        else if (kind === "invited")
          await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${mail.owner.id}`);
        else await db.execute(sql`UPDATE users SET is_active=false WHERE id=${mail.owner.id}`);
      },
    };
  } catch (error) {
    await mail.close();
    throw error;
  }
}

export async function notificationAttempts(db: Db, notificationId: string) {
  return (
    await db.execute(sql`SELECT id,account_id,idempotency_key,payload,send_started_at,status,delivery_outcome
    FROM email_send_attempts WHERE idempotency_key=${notificationId}
      OR payload->'systemPurpose'->>'notificationId'=${notificationId} ORDER BY account_id,id`)
  ).rows;
}

export type NotificationSmtpFixture = Awaited<ReturnType<typeof notificationSmtpFixture>>;

export function enqueueRetainedNotification(db: Db, f: NotificationSmtpFixture) {
  return enqueueSend(db, {
    accountId: f.accountId,
    idempotencyKey: f.notificationId,
    payload: {
      to: [f.runtime.emailAddress],
      subject: "Fixture notification",
      html: "<p>Private notice</p>",
      visibility: "private",
      trackOpens: false,
      trackLinks: false,
      systemPurpose: {
        version: 1,
        kind: "notification",
        notificationId: f.notificationId,
        recipientUserId: f.owner.id,
      },
    },
  });
}

export function notificationGmail(f: NotificationSmtpFixture) {
  const gmail = new FakeGmailClient();
  gmail.messages.set("sent-1", {
    id: "sent-1",
    threadId: "t1",
    labelIds: ["SENT"],
    payload: {
      mimeType: "text/html",
      body: { data: Buffer.from("<p>Private notice</p>").toString("base64url") },
      headers: [
        { name: "From", value: f.runtime.emailAddress },
        { name: "To", value: f.runtime.emailAddress },
        { name: "Subject", value: "Fixture notification" },
      ],
    },
  });
  return gmail;
}
