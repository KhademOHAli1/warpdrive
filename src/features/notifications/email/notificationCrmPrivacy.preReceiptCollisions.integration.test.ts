import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";
import {
  expectPrivateObservation,
  preparedGmailIntakeFixture,
} from "./notificationCrmPrivacy.preReceipt.test-helpers";
import { NOTIFICATION_PROVIDER_MESSAGE_ID } from "./notificationCrmPrivacy.test-helpers";

it("never adopts or modifies an existing shared user row that collides with a later Gmail ACK ID", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await preparedGmailIntakeFixture(db, signal, "fa");
    await db.execute(sql`INSERT INTO email_messages
      (account_id,thread_id,gmail_message_id,provider_message_id,direction,from_email,
       subject,snippet,body_html,body_text)
      VALUES (${f.account.id},${f.originalThreadId},${NOTIFICATION_PROVIDER_MESSAGE_ID},
        ${NOTIFICATION_PROVIDER_MESSAGE_ID},'inbound','customer@example.test',
        'Independent user message','Original user snippet','<p>Original user HTML</p>','Original user text')`);
    signal.throwIfAborted();
    const original = await f.allRows();
    const providerSend = f.transport.gmail.sendRaw.bind(f.transport.gmail);
    f.transport.gmail.sendRaw = async (args) => {
      const accepted = await providerSend(args);
      if (!accepted.ok) return accepted;
      const intake = await f.observe([accepted.value.id]);
      expect.soft(intake.touchedThreadIds).not.toContain("t1");
      const observed = await f.observed(accepted.value.id);
      const synthetic = observed.filter((row) => row.gmail_message_id === null);
      expectPrivateObservation(synthetic, f.originalThreadId);
      const rows = await f.allRows();
      expect.soft(rows).toEqual(expect.arrayContaining(original));
      expect.soft(rows).toHaveLength(original.length + 1);
      return accepted;
    };
    expect(await f.send()).toEqual(
      ok({
        status: "sent",
        gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
      }),
    );
    expect
      .soft(
        await runEmailNotificationJob(
          db,
          { notificationId: f.notificationId },
          signal,
          f.transport.deps,
        ),
      )
      .not.toEqual(ok({ sent: true }));
    const after = await f.allRows();
    expect.soft(after).toEqual(expect.arrayContaining(original));
    expect.soft(after).toHaveLength(original.length + 1);
    expect.soft((await f.attempt())[0]?.email_sent_at).toBeNull();
    expect(await f.attempt()).toMatchObject([
      {
        gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        provider_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        delivery_outcome: {
          evidence: "api_ack",
          providerMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
        },
      },
    ]);
    await runEmailNotificationJob(
      db,
      { notificationId: f.notificationId },
      signal,
      f.transport.deps,
    );
    expect.soft(await f.allRows()).toEqual(after);
    expect.soft((await f.attempt())[0]?.email_sent_at).toBeNull();
    expect(f.transport.gmail.raw).toHaveLength(1);
    expect(f.transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
  });
});

it("does not promote or overwrite a privately observed message edited before its exact Gmail ACK", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await preparedGmailIntakeFixture(db, signal, "de");
    const originalCustomer = await f.originalState();
    let edited: Awaited<ReturnType<typeof f.allRows>> = [];
    const providerSend = f.transport.gmail.sendRaw.bind(f.transport.gmail);
    f.transport.gmail.sendRaw = async (args) => {
      const accepted = await providerSend(args);
      if (!accepted.ok) return accepted;
      const intake = await f.observe([accepted.value.id]);
      expect.soft(intake.result).toMatchObject({ ok: true });
      const observed = await f.observed(accepted.value.id);
      expect(observed).toHaveLength(1);
      expectPrivateObservation(observed, f.originalThreadId);
      expect.soft(await f.originalState()).toEqual(originalCustomer);
      // Simulate an intervening local edit. Promotion must detect its immutable
      // intake baseline differs, rather than replacing this user's version.
      await db.execute(sql`UPDATE email_messages
        SET body_html='<p>Owner edited this message</p>',body_text='Owner edited this message',
          snippet='Owner edited snippet'
        WHERE account_id=${f.account.id} AND id=${observed[0]?.id}`);
      signal.throwIfAborted();
      edited = await f.allRows();
      return accepted;
    };
    expect(await f.send()).toEqual(
      ok({
        status: "sent",
        gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
      }),
    );
    expect
      .soft(
        await runEmailNotificationJob(
          db,
          { notificationId: f.notificationId },
          signal,
          f.transport.deps,
        ),
      )
      .not.toEqual(ok({ sent: true }));
    expect.soft(await f.allRows()).toEqual(edited);
    expect.soft((await f.attempt())[0]?.email_sent_at).toBeNull();
    expect.soft(await f.originalState()).toEqual(originalCustomer);
    await runEmailNotificationJob(
      db,
      { notificationId: f.notificationId },
      signal,
      f.transport.deps,
    );
    expect.soft(await f.allRows()).toEqual(edited);
    expect.soft((await f.attempt())[0]?.email_sent_at).toBeNull();
    expect(f.transport.gmail.raw).toHaveLength(1);
    expect(f.transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
  });
});
