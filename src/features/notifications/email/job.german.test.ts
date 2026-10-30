import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { notifications } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { SystemMessage } from "@/features/email/sendSystem";
import { getPreferences, setPreferences } from "@/features/identity/preferencesRepo";
import { setPreference } from "@/features/notifications/preferences";
import type { EmailAccountRow } from "@/types/email";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";

async function connectMailbox(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  userId: string,
  address = `mailbox-${Date.now()}@example.com`,
): Promise<EmailAccountRow> {
  const row = (
    await db.execute(sql`
      INSERT INTO email_accounts (user_id, email_address, status)
      VALUES (${userId}, ${address}, 'connected')
      RETURNING id, user_id, email_address
    `)
  ).rows[0] as { id: string; user_id: string; email_address: string } | undefined;
  if (row === undefined) throw new Error("connectMailbox: insert returned no rows");
  return { id: row.id, userId: row.user_id, emailAddress: row.email_address };
}

// Insert a deal and return its id. Uses raw SQL (no seedDeal factory exists).
async function seedDeal(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  opts: { ownerId: string; visibilityLevel: "owner" | "all" },
): Promise<string> {
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
  const stage = stages[0];
  if (stage === undefined) throw new Error("seedDeal: no stage");
  const row = (
    await db.execute(sql`
      INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level)
      VALUES ('Test Deal', ${pipeline.id}, ${stage.id}, ${opts.ownerId}, ${opts.visibilityLevel})
      RETURNING id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined) throw new Error("seedDeal: insert returned no rows");
  return row.id;
}

it("uses a queued recipient's latest German preference and preserves payload, escaping and retry identity", async () => {
  await withTestDb(async (db) => {
    const recipient = await seedUser(db, { name: "Jörg <Nord> & Co" });
    const actor = await seedUser(db);
    const mailbox = await connectMailbox(db, recipient.id, "german-recipient@example.com");
    const signal = new AbortController().signal;
    const persian = { locale: "fa", calendar: "persian", timeZone: "Asia/Tehran" } as const;
    await setPreferences(db, recipient.id, { ui: { localePreferences: persian } }, signal);
    await setPreferences(db, actor.id, { ui: { localePreferences: persian } }, signal);
    await setPreference(
      db,
      recipient.id,
      "activity_reminder",
      { inApp: true, email: true },
      signal,
    );
    const dealId = await seedDeal(db, { ownerId: recipient.id, visibilityLevel: "all" });
    const payload = { subject: "Rückruf <Acme> & Co" };
    const [notification] = await db
      .insert(notifications)
      .values({
        userId: recipient.id,
        type: "activity_reminder",
        entityType: "deal",
        entityId: dealId,
        actorId: actor.id,
        payload,
      })
      .returning();
    if (notification === undefined) throw new Error("notification insert failed");
    // Language can change after enqueue. Rendering must use the recipient at send time.
    const german = {
      locale: "de",
      calendar: "persian",
      timeZone: "Europe/Berlin",
      numberingSystem: "arabext",
    } as const;
    await setPreferences(
      db,
      recipient.id,
      { timezone: "Europe/Berlin", ui: { localePreferences: german } },
      signal,
    );
    const sent: SystemMessage[] = [];
    const send = (account: EmailAccountRow, message: SystemMessage) => {
      expect(account.userId).toBe(recipient.id);
      sent.push(message);
      return Promise.resolve(ok({ gmailMessageId: "fake-german-id" }));
    };

    const result = await runEmailNotificationJob(db, { notificationId: notification.id }, signal, {
      send,
    });

    expect(result).toEqual(ok({ sent: true }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual([mailbox.emailAddress]);
    expect(sent[0]?.subject).toBe("Erinnerung: Rückruf <Acme> & Co ist bald fällig");
    expect(sent[0]?.bodyText).toContain("Jörg <Nord> & Co, Ihre Aktivität „Rückruf <Acme> & Co“");
    expect(sent[0]?.bodyText).toContain(`/deals/${dealId}`);
    expect(sent[0]?.bodyHtml).toContain('lang="de" dir="ltr"');
    expect(sent[0]?.bodyHtml).toContain("Jörg &lt;Nord&gt; &amp; Co");
    expect(sent[0]?.bodyHtml).toContain("Rückruf &lt;Acme&gt; &amp; Co");
    expect(sent[0]?.bodyHtml).not.toContain("<Acme>");
    expect(sent[0]?.idempotencyKey).toBe(notification.id);
    expect(
      await runEmailNotificationJob(db, { notificationId: notification.id }, signal, { send }),
    ).toEqual(ok({ sent: false }));
    expect(sent).toHaveLength(1);
    const [stored] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notification.id));
    expect(stored).toMatchObject({ type: "activity_reminder", actorId: actor.id, payload });
    expect(stored?.emailSentAt).not.toBeNull();
    expect((await getPreferences(db, recipient.id, signal)).ui.localePreferences).toEqual(german);
  });
});
