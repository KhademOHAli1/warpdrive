import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { listActorMailboxes } from "./mailAccountsRepo";
import {
  assertMailboxOwner,
  getActorGmailMailboxStatus,
  getActorMailbox,
} from "./mailboxOwnership";

// Codex finding F5: the send action must confirm mailbox ownership BEFORE any token
// decrypt/refresh side effect. assertMailboxOwner returns the SAME error for a missing
// account and a non-owned account (no existence probing), and the address when owned.

async function seedAccount(
  db: Parameters<typeof seedUser>[0],
  userId: string,
  email: string,
): Promise<string> {
  const r = await db.execute(
    sql`INSERT INTO email_accounts (user_id, email_address) VALUES (${userId}, ${email}) RETURNING id`,
  );
  return (r.rows[0] as { id: string }).id;
}

describe("assertMailboxOwner", () => {
  it("returns the address when the account belongs to the actor", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      const accountId = await seedAccount(db, u.id, "me@example.com");
      const r = await assertMailboxOwner(db, accountId, u.id, new AbortController().signal);
      expect(r.ok).toBe(true);
      if (r.ok === false) return;
      expect(r.value.emailAddress).toBe("me@example.com");
    });
  });

  it("denies (E_PERM_001) when the account belongs to another user", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const attacker = await seedUser(db);
      const accountId = await seedAccount(db, owner.id, "owner@example.com");
      const r = await assertMailboxOwner(db, accountId, attacker.id, new AbortController().signal);
      expect(r.ok).toBe(false);
      if (r.ok === true) return;
      expect(r.error.id).toBe("E_PERM_001");
    });
  });

  it("denies (E_PERM_001) for an unknown account id (no existence probing)", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      const r = await assertMailboxOwner(db, randomUUID(), u.id, new AbortController().signal);
      expect(r.ok).toBe(false);
      if (r.ok === true) return;
      expect(r.error.id).toBe("E_PERM_001");
    });
  });
});

describe("getActorMailbox", () => {
  it("prefers an available sender over a paused default without hiding retained offline history", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const paused = await seedAccount(db, owner.id, "paused@mail.test");
      const active = await seedAccount(db, owner.id, "active@mail.test");
      await db.execute(
        sql`UPDATE email_accounts SET is_default=true,paused=true WHERE id=${paused}`,
      );
      expect(await getActorMailbox(db, owner.id, new AbortController().signal)).toEqual({
        id: active,
        emailAddress: "active@mail.test",
      });
      await db.execute(sql`UPDATE email_accounts SET status='disconnected' WHERE id=${active}`);
      expect(await getActorMailbox(db, owner.id, new AbortController().signal)).toEqual({
        id: paused,
        emailAddress: "paused@mail.test",
      });
    });
  });
  it("returns the actor's connected mailbox id and address", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      const accountId = await seedAccount(db, u.id, "rep@example.com");
      const box = await getActorMailbox(db, u.id, new AbortController().signal);
      expect(box).toEqual({ id: accountId, emailAddress: "rep@example.com" });
    });
  });

  it("returns null when the actor has no mailbox linked", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      const box = await getActorMailbox(db, u.id, new AbortController().signal);
      expect(box).toBeNull();
    });
  });
});

describe("getActorGmailMailboxStatus", () => {
  it.each(["connected", "disconnected", "error"] as const)(
    "returns the owner's nondefault Gmail %s status instead of their default IMAP mailbox",
    async (status) => {
      await withTestDb(async (db) => {
        const owner = await seedUser(db);
        const imap = randomUUID();
        const gmail = randomUUID();
        const lastErrorId = status === "connected" ? null : "E_GMAIL_002";
        await db.execute(sql`
          INSERT INTO email_accounts (id,user_id,email_address,provider,is_default,created_at)
          VALUES (${imap},${owner.id},'default@imap.test','imap_smtp',true,'2020-01-01T00:00:00Z')
        `);
        await db.execute(sql`
          INSERT INTO email_accounts (id,user_id,email_address,provider,is_default,status,last_sync_at,last_error_id,created_at)
          VALUES (${gmail},${owner.id},'own@gmail.test','gmail',false,${status},'2026-07-01T10:00:00Z',${lastErrorId},'2021-01-01T00:00:00Z')
        `);
        const signal = AbortSignal.timeout(5_000);
        expect(await getActorMailbox(db, owner.id, signal)).toEqual({
          id: imap,
          emailAddress: "default@imap.test",
        });
        const managed = await listActorMailboxes(db, owner.id, signal);
        expect(managed.map((row) => row.id)).toEqual([imap, gmail]);
        expect(managed[0]).toMatchObject({ provider: "imap_smtp", isDefault: true });
        expect(await getActorGmailMailboxStatus(db, owner.id, signal)).toEqual({
          id: gmail,
          emailAddress: "own@gmail.test",
          status,
          lastSyncAt: new Date("2026-07-01T10:00:00Z"),
          lastErrorId,
        });
      });
    },
  );

  it("returns no Gmail status for an IMAP-only owner even when another user has Gmail", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const other = await seedUser(db);
      const imap = randomUUID();
      await db.execute(sql`
        INSERT INTO email_accounts (id,user_id,email_address,provider,is_default)
        VALUES (${imap},${owner.id},'only@imap.test','imap_smtp',true),
          (${randomUUID()},${other.id},'other@gmail.test','gmail',true)
      `);
      const signal = AbortSignal.timeout(5_000);
      expect(await getActorMailbox(db, owner.id, signal)).toEqual({
        id: imap,
        emailAddress: "only@imap.test",
      });
      expect(await getActorGmailMailboxStatus(db, owner.id, signal)).toBeNull();
    });
  });

  it("returns status, last sync, and last error for the actor's mailbox", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      const r = await db.execute(sql`
        INSERT INTO email_accounts (user_id, email_address, status, last_sync_at, last_error_id)
        VALUES (${u.id}, 'rep@example.com', 'connected', '2026-07-01T10:00:00Z', NULL)
        RETURNING id
      `);
      const id = (r.rows[0] as { id: string }).id;
      const box = await getActorGmailMailboxStatus(db, u.id, new AbortController().signal);
      expect(box).not.toBeNull();
      expect(box?.id).toBe(id);
      expect(box?.emailAddress).toBe("rep@example.com");
      expect(box?.status).toBe("connected");
      expect(box?.lastSyncAt?.toISOString()).toBe("2026-07-01T10:00:00.000Z");
      expect(box?.lastErrorId).toBeNull();
    });
  });

  it("returns null when the actor has no mailbox linked", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      expect(await getActorGmailMailboxStatus(db, u.id, new AbortController().signal)).toBeNull();
    });
  });

  it("reflects a disconnected status with its error id", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      await db.execute(sql`
        INSERT INTO email_accounts (user_id, email_address, status, last_error_id)
        VALUES (${u.id}, 'rep@example.com', 'disconnected', 'E_GMAIL_002')
      `);
      const box = await getActorGmailMailboxStatus(db, u.id, new AbortController().signal);
      expect(box?.status).toBe("disconnected");
      expect(box?.lastErrorId).toBe("E_GMAIL_002");
    });
  });
});
