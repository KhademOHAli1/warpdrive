import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { notifications } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { getPreferences, setPreferences } from "@/features/identity/preferencesRepo";
import { setPreference } from "@/features/notifications/preferences";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";
import {
  assertNotificationJobAccepted,
  connectNotificationMailbox,
  insertJobNotification,
  notificationJobTransport,
  seedNotificationDeal,
} from "./notificationJob.test-helpers";

it("uses a queued recipient's latest German preference and preserves payload, escaping and retry identity", async () => {
  await withTestDb(async (db) => {
    const recipient = await seedUser(db, { name: "Jörg <Nord> & Co" });
    const actor = await seedUser(db);
    const signal = AbortSignal.timeout(30_000);
    const mailbox = await connectNotificationMailbox(
      db,
      recipient.id,
      signal,
      "german-recipient@example.com",
    );
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
    const dealId = await seedNotificationDeal(db, recipient.id, "all", signal);
    const payload = { subject: "Rückruf <Acme> & Co" };
    const notification = await insertJobNotification(
      db,
      {
        userId: recipient.id,
        type: "activity_reminder",
        entityType: "deal",
        entityId: dealId,
        actorId: actor.id,
        payload,
      },
      signal,
    );
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
    const transport = notificationJobTransport();
    expect(
      await runEmailNotificationJob(
        db,
        { notificationId: notification.id },
        signal,
        transport.deps,
      ),
    ).toEqual(ok({ sent: true }));
    const sent = await transport.wireMessages(signal);
    expect(sent).toHaveLength(1);
    const to = sent[0]?.to;
    const groups = to === undefined ? [] : Array.isArray(to) ? to : [to];
    expect(groups.flatMap((group) => group.value.map((entry) => entry.address))).toEqual([
      mailbox.emailAddress,
    ]);
    expect(sent[0]?.subject).toBe("Erinnerung: Rückruf <Acme> & Co ist bald fällig");
    expect(sent[0]?.text).toContain("Jörg <Nord> & Co, Ihre Aktivität „Rückruf <Acme> & Co“");
    expect(sent[0]?.text).toContain(`/deals/${dealId}`);
    expect(sent[0]?.html).toContain('lang="de" dir="ltr"');
    expect(sent[0]?.html).toContain("Jörg &lt;Nord&gt; &amp; Co");
    expect(sent[0]?.html).toContain("Rückruf &lt;Acme&gt; &amp; Co");
    expect(sent[0]?.html).not.toContain("<Acme>");
    const attempts = (
      await db.execute(
        sql`SELECT message_id_header FROM email_send_attempts WHERE idempotency_key=${notification.id}`,
      )
    ).rows;
    expect(attempts).toEqual([{ message_id_header: sent[0]?.messageId }]);
    await assertNotificationJobAccepted(db, {
      notificationId: notification.id,
      account: mailbox,
      signal,
    });
    expect(
      await runEmailNotificationJob(
        db,
        { notificationId: notification.id },
        signal,
        transport.deps,
      ),
    ).toEqual(ok({ sent: false }));
    expect(transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
    const [stored] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notification.id));
    expect(stored).toMatchObject({ type: "activity_reminder", actorId: actor.id, payload });
    expect(stored?.emailSentAt).not.toBeNull();
    expect((await getPreferences(db, recipient.id, signal)).ui.localePreferences).toEqual(german);
  });
});
