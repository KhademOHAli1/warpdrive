import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { commitMailboxProof, createMailboxProof } from "./mailConnectionProofs";

const signal = () => AbortSignal.timeout(30_000);
const settings = {
  emailAddress: "vertrieb@example.test",
  imap: {
    host: "mail.example.test",
    port: 993,
    security: "tls" as const,
    username: "vertrieb@example.test",
    password: "synthetic-imap-password",
  },
  smtp: {
    host: "mail.example.test",
    port: 465,
    security: "tls" as const,
    username: "vertrieb@example.test",
    password: "synthetic-smtp-password",
  },
};
const checked = {
  input: settings,
  identityKey: "synthetic-mailbox-identity",
  folders: [{ path: "INBOX", name: "Inbox", role: "inbox" as const, readOnly: false }],
  capabilities: { read: true, send: true, markRead: true, move: true, trash: false },
};

async function context(db: Parameters<typeof seedUser>[0]) {
  const user = await seedUser(db);
  await db.execute(
    sql`INSERT INTO auth_users(id,email,name,email_verified) VALUES(${user.id},${user.email},${user.name},true)`,
  );
  const sessionId = randomUUID();
  await db.execute(sql`
    INSERT INTO sessions (id, user_id, token_hash, expires_at,auth_method,assurance,fresh_authenticated_at)
    VALUES (${sessionId}, ${user.id}, ${randomUUID()}, now()+interval '1 hour','password','password',now())
  `);
  return { actorId: user.id, sessionId };
}

it("keeps checked credentials encrypted and binds the single-use proof to actor and session", async () => {
  await withTestDb(async (db) => {
    const owner = await context(db);
    const outsider = await context(db);
    const created = await createMailboxProof(db, owner, checked, signal());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = (await db.execute(sql`SELECT * FROM mail_connection_checks`)).rows[0];
    expect(JSON.stringify(row)).not.toContain("synthetic-imap-password");
    expect(JSON.stringify(row)).not.toContain(created.value.checkId);
    const input = {
      checkId: created.value.checkId,
      folderPaths: ["INBOX"],
      historyDays: 90,
      isDefault: true,
    };
    expect((await commitMailboxProof(db, outsider, input, signal())).ok).toBe(false);
    expect(
      (await commitMailboxProof(db, { ...owner, sessionId: outsider.sessionId }, input, signal()))
        .ok,
    ).toBe(false);
    const accepted = await commitMailboxProof(db, owner, input, signal());
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value).toMatchObject({
      emailAddress: settings.emailAddress,
      provider: "imap_smtp",
      isDefault: true,
    });
    expect((await commitMailboxProof(db, owner, input, signal())).ok).toBe(false);
    const used = (
      await db.execute(sql`SELECT payload_enc, consumed_at FROM mail_connection_checks`)
    ).rows[0];
    expect(used).toMatchObject({ payload_enc: null });
    expect(used?.consumed_at).not.toBeNull();
  });
});

it("rejects expired proofs, arbitrary folder injection and revoked sessions", async () => {
  await withTestDb(async (db) => {
    const owner = await context(db);
    const created = await createMailboxProof(db, owner, checked, signal());
    if (!created.ok) throw new Error("fixture proof failed");
    const input = {
      checkId: created.value.checkId,
      folderPaths: ["INBOX"],
      historyDays: 90,
      isDefault: false,
    };
    expect(
      (await commitMailboxProof(db, owner, { ...input, folderPaths: ["not-discovered"] }, signal()))
        .ok,
    ).toBe(false);
    await db.execute(sql`UPDATE mail_connection_checks SET expires_at=now()-interval '1 second'`);
    expect((await commitMailboxProof(db, owner, input, signal())).ok).toBe(false);
    const fresh = await createMailboxProof(db, owner, checked, signal());
    if (!fresh.ok) throw new Error("fixture proof failed");
    await db.execute(sql`UPDATE sessions SET revoked_at=now() WHERE id=${owner.sessionId}`);
    expect(
      (await commitMailboxProof(db, owner, { ...input, checkId: fresh.value.checkId }, signal()))
        .ok,
    ).toBe(false);
    expect((await db.execute(sql`SELECT id FROM email_accounts`)).rows).toHaveLength(0);
  });
});

it("rejects a duplicate mailbox identity without merging another owner's history", async () => {
  await withTestDb(async (db) => {
    const first = await context(db);
    const second = await context(db);
    for (const [index, owner] of [first, second].entries()) {
      const result = await createMailboxProof(
        db,
        owner,
        {
          ...checked,
          input: { ...settings, emailAddress: `alias${index}@example.test` },
        },
        signal(),
      );
      if (!result.ok) throw new Error("fixture proof failed");
      const committed = await commitMailboxProof(
        db,
        owner,
        {
          checkId: result.value.checkId,
          folderPaths: ["INBOX"],
          historyDays: 90,
          isDefault: true,
        },
        signal(),
      );
      expect(committed.ok).toBe(index === 0);
    }
    expect((await db.execute(sql`SELECT user_id FROM email_accounts`)).rows).toEqual([
      { user_id: first.actorId },
    ]);
  });
});
