import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { FakeGmailClient } from "./gmailFake";
import { recoverFrom404 } from "./resync";
import { msg, newSignal, seedAccount, type TestDb } from "./resyncTestHarness";
import { syncMailbox } from "./sync";

async function change(db: TestDb, accountId: string, userId: string, kind: string) {
  if (kind === "inactive")
    await db.execute(sql`UPDATE users SET is_active=false WHERE id=${userId}`);
  else if (kind === "invited")
    await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${userId}`);
  else if (kind === "pause")
    await db.execute(
      sql`UPDATE email_accounts SET paused=true,connection_generation=connection_generation+1 WHERE id=${accountId}`,
    );
  else if (kind === "reconnect")
    await db.execute(
      sql`UPDATE email_accounts SET connection_generation=connection_generation+1,last_error_id=NULL WHERE id=${accountId}`,
    );
  else
    await db.execute(
      sql`UPDATE email_accounts SET status='disconnected',refresh_token_enc=NULL,connection_generation=connection_generation+1 WHERE id=${accountId}`,
    );
}

async function snapshot(db: TestDb, accountId: string) {
  return (
    await db.execute(
      sql`SELECT status,paused,last_history_id,last_error_id FROM email_accounts WHERE id=${accountId}`,
    )
  ).rows[0];
}

describe("Gmail background authority fencing", () => {
  it.each(["disconnect", "reconnect", "pause", "inactive", "invited"])(
    "does not seed a cursor after %s during profile IO",
    async (kind) => {
      await withTestDb(async (db) => {
        const f = await seedAccount(db, { startHistoryId: "100" });
        await db.execute(sql`UPDATE email_accounts SET last_history_id=NULL WHERE id=${f.acctId}`);
        const fake = new FakeGmailClient();
        fake.profileHistoryId = "900";
        const fetch = fake.getProfile.bind(fake);
        let afterChange: unknown;
        vi.spyOn(fake, "getProfile").mockImplementation(async (args) => {
          await change(db, f.acctId, f.userId, kind);
          afterChange = await snapshot(db, f.acctId);
          return fetch(args);
        });
        await syncMailbox(db, { accountId: f.acctId, gmail: fake, signal: newSignal() });
        expect(await snapshot(db, f.acctId)).toEqual(afterChange);
      });
    },
  );

  it.each(["disconnect", "reconnect", "pause", "inactive"])(
    "does not persist messages after %s during message IO",
    async (kind) => {
      await withTestDb(async (db) => {
        const f = await seedAccount(db, { startHistoryId: "100" });
        const fake = new FakeGmailClient();
        fake.historyPages = [
          {
            historyId: "900",
            history: [{ messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] }],
          },
        ];
        fake.messages.set("m1", msg("m1", "t1", "external@example.test"));
        const fetch = fake.getMessage.bind(fake);
        let afterChange: unknown;
        vi.spyOn(fake, "getMessage").mockImplementation(async (args) => {
          await change(db, f.acctId, f.userId, kind);
          afterChange = await snapshot(db, f.acctId);
          return fetch(args);
        });
        await syncMailbox(db, { accountId: f.acctId, gmail: fake, signal: newSignal() });
        expect(
          (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.acctId}`)).rows,
        ).toHaveLength(0);
        expect(
          (await db.execute(sql`SELECT id FROM email_threads WHERE account_id=${f.acctId}`)).rows,
        ).toHaveLength(0);
        expect(await snapshot(db, f.acctId)).toEqual(afterChange);
      });
    },
  );

  it("does not apply a stale trash transition or advance the cursor after a reconnect during thread IO", async () => {
    await withTestDb(async (db) => {
      const f = await seedAccount(db, { startHistoryId: "100" });
      await db.execute(
        sql`INSERT INTO email_threads(account_id,gmail_thread_id) VALUES(${f.acctId},'t1')`,
      );
      const fake = new FakeGmailClient();
      fake.historyPages = [
        {
          historyId: "900",
          history: [
            { labelsAdded: [{ message: { id: "m1", threadId: "t1" }, labelIds: ["TRASH"] }] },
          ],
        },
      ];
      fake.threads.set("t1", { id: "t1", messages: [{ id: "m1", labelIds: ["TRASH"] }] });
      const fetch = fake.getThread.bind(fake);
      vi.spyOn(fake, "getThread").mockImplementation(async (args) => {
        await change(db, f.acctId, f.userId, "reconnect");
        return fetch(args);
      });
      await syncMailbox(db, { accountId: f.acctId, gmail: fake, signal: newSignal() });
      expect(
        (await db.execute(sql`SELECT trashed_at FROM email_threads WHERE account_id=${f.acctId}`))
          .rows[0]?.trashed_at,
      ).toBeNull();
      expect((await snapshot(db, f.acctId))?.last_history_id).toBe("100");
    });
  });

  it("does not resurrect a disconnected account during 404 recovery's final profile IO", async () => {
    await withTestDb(async (db) => {
      const f = await seedAccount(db, { startHistoryId: "100" });
      const fake = new FakeGmailClient();
      fake.profileHistoryId = "900";
      const fetch = fake.getProfile.bind(fake);
      vi.spyOn(fake, "getProfile").mockImplementation(async (args) => {
        await change(db, f.acctId, f.userId, "disconnect");
        return fetch(args);
      });
      await recoverFrom404(db, { accountId: f.acctId, gmail: fake, signal: newSignal() });
      expect((await snapshot(db, f.acctId))?.status).toBe("disconnected");
      expect((await snapshot(db, f.acctId))?.last_history_id).toBe("100");
    });
  });

  it("does not use a client authorized for an older generation even before the sync starts", async () => {
    await withTestDb(async (db) => {
      const f = await seedAccount(db, { startHistoryId: "100" });
      await change(db, f.acctId, f.userId, "reconnect");
      const fake = new FakeGmailClient();
      await syncMailbox(db, {
        accountId: f.acctId,
        expectedGeneration: 1,
        gmail: fake,
        signal: newSignal(),
      });
      expect(fake.calls).toHaveLength(0);
    });
  });
});

it("continues an authorized sync after routine refresh-token rotation without a connection-generation change", async () => {
  await withTestDb(async (db) => {
    const f = await seedAccount(db, { startHistoryId: "100" });
    const fake = new FakeGmailClient();
    fake.historyPages = [
      {
        historyId: "900",
        history: [{ messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] }],
      },
    ];
    fake.messages.set("m1", msg("m1", "t1", "external@example.test"));
    const fetch = fake.getMessage.bind(fake);
    vi.spyOn(fake, "getMessage").mockImplementation(async (args) => {
      await db.execute(
        sql`UPDATE email_accounts SET credential_version=credential_version+1 WHERE id=${f.acctId}`,
      );
      return fetch(args);
    });
    const result = await syncMailbox(db, {
      accountId: f.acctId,
      expectedGeneration: 1,
      gmail: fake,
      signal: newSignal(),
    });
    expect(result).toEqual({ ok: true, value: { applied: 1 } });
    expect((await snapshot(db, f.acctId))?.last_history_id).toBe("900");
    expect(
      (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.acctId}`)).rows,
    ).toHaveLength(1);
  });
});

it("writes provider-neutral and legacy Gmail identities together for newly synchronized rows", async () => {
  await withTestDb(async (db) => {
    const f = await seedAccount(db, { startHistoryId: "100" });
    const fake = new FakeGmailClient();
    fake.historyPages = [
      {
        historyId: "900",
        history: [{ messagesAdded: [{ message: { id: "m-generic", threadId: "t-generic" } }] }],
      },
    ];
    fake.messages.set("m-generic", msg("m-generic", "t-generic", "external@example.test"));
    expect(
      (await syncMailbox(db, { accountId: f.acctId, gmail: fake, signal: newSignal() })).ok,
    ).toBe(true);
    expect(
      (
        await db.execute(
          sql`SELECT gmail_message_id,provider_message_id FROM email_messages WHERE account_id=${f.acctId}`,
        )
      ).rows,
    ).toEqual([{ gmail_message_id: "m-generic", provider_message_id: "m-generic" }]);
    expect(
      (
        await db.execute(
          sql`SELECT gmail_thread_id,provider_thread_id FROM email_threads WHERE account_id=${f.acctId}`,
        )
      ).rows,
    ).toEqual([{ gmail_thread_id: "t-generic", provider_thread_id: "t-generic" }]);
  });
});
