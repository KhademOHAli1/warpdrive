import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { disconnectMailbox, listActorMailboxes, selectDefaultMailbox } from "./mailAccountsRepo";
import { getActorMailbox } from "./mailboxOwnership";

const signal = AbortSignal.timeout(60_000);

describe("personal mailbox identity and lifecycle", () => {
  it("preserves a Gmail account and adds independent mailboxes without exposing credentials", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const other = await seedUser(db);
      const gmail = randomUUID();
      const imap = randomUUID();
      await db.execute(sql`
        INSERT INTO email_accounts (id, user_id, email_address, refresh_token_enc)
        VALUES (${gmail}, ${owner.id}, 'original@example.test', decode('0102','hex'))
      `);
      await db.execute(sql`
        INSERT INTO email_accounts (id, user_id, email_address, provider, is_default, credentials_enc)
        VALUES (${imap}, ${owner.id}, 'فروش@example.test', 'imap_smtp', true, decode('0304','hex'))
      `);
      const rows = await listActorMailboxes(db, owner.id, signal);
      expect(rows.map((row) => row.id)).toEqual([imap, gmail]);
      expect(rows[0]).toMatchObject({ provider: "imap_smtp", isDefault: true });
      expect(await getActorMailbox(db, owner.id, signal)).toEqual({
        id: imap,
        emailAddress: "فروش@example.test",
      });
      expect(await listActorMailboxes(db, other.id, signal)).toEqual([]);
      expect(JSON.stringify(rows)).not.toMatch(/token|password|credentials|0102|0304/i);
    });
  });

  it("serializes default sender changes and rejects another owner's mailbox", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const outsider = await seedUser(db);
      const ids = [randomUUID(), randomUUID()];
      for (const [index, id] of ids.entries())
        await db.execute(sql`
          INSERT INTO email_accounts (id, user_id, email_address, provider)
          VALUES (${id}, ${owner.id}, ${`mail${index}@example.test`}, 'imap_smtp')
        `);
      const attempts = await Promise.all(
        ids.map((id) => selectDefaultMailbox(db, owner.id, id, signal)),
      );
      expect(attempts.every((result) => result.ok)).toBe(true);
      expect(
        (await listActorMailboxes(db, owner.id, signal)).filter((row) => row.isDefault),
      ).toHaveLength(1);
      expect((await selectDefaultMailbox(db, outsider.id, ids[0]!, signal)).ok).toBe(false);
    });
  });

  it("disconnects only the owned account and invalidates encrypted credentials and old jobs", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const outsider = await seedUser(db);
      const id = randomUUID();
      await db.execute(sql`
        INSERT INTO email_accounts (id, user_id, email_address, provider, credentials_enc)
        VALUES (${id}, ${owner.id}, 'vertrieb@example.test', 'imap_smtp', decode('0102','hex'))
      `);
      expect((await disconnectMailbox(db, outsider.id, id, signal)).ok).toBe(false);
      expect((await disconnectMailbox(db, owner.id, id, signal)).ok).toBe(true);
      const row = (
        await db.execute(sql`
        SELECT status, connection_generation, credentials_enc, refresh_token_enc
        FROM email_accounts WHERE id=${id}
      `)
      ).rows[0];
      expect(row).toMatchObject({
        status: "disconnected",
        connection_generation: 2,
        credentials_enc: null,
        refresh_token_enc: null,
      });
    });
  });
});
