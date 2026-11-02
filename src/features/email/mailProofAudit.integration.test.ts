import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { commitMailboxProof, createMailboxProof } from "./mailConnectionProofs";

it("records a redacted connection grant atomically with single-use credential consumption", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const sessionId = randomUUID();
    await db.execute(sql`
      INSERT INTO auth_users (id,email,name,email_verified) VALUES (${owner.id},${owner.email},${owner.name},true)
    `);
    await db.execute(sql`
      INSERT INTO sessions (id,user_id,token_hash,expires_at,auth_method,assurance,fresh_authenticated_at)
      VALUES (${sessionId},${owner.id},${randomUUID()},now()+interval '1 hour','password','password',now())
    `);
    const context = { actorId: owner.id, sessionId };
    const endpoint = {
      host: "mail.example.test",
      port: 993,
      security: "tls" as const,
      username: "owner@example.test",
      password: "synthetic-never-in-audit",
    };
    const checked = await createMailboxProof(
      db,
      context,
      {
        input: {
          emailAddress: "owner@example.test",
          imap: endpoint,
          smtp: { ...endpoint, port: 465 },
        },
        identityKey: "audit-test-identity",
        folders: [{ path: "INBOX", name: "Inbox", role: "inbox", readOnly: false }],
        capabilities: { read: true, send: true, markRead: true, move: true, trash: false },
      },
      AbortSignal.timeout(10_000),
    );
    if (!checked.ok) throw new Error("proof fixture denied");
    const queued: string[] = [];
    const saved = await commitMailboxProof(
      db,
      context,
      {
        checkId: checked.value.checkId,
        folderPaths: ["INBOX"],
        historyDays: 90,
        isDefault: true,
      },
      AbortSignal.timeout(10_000),
      {
        enqueueSync: async (id: string) => {
          const proof = (
            await db.execute(
              sql`SELECT consumed_at,payload_enc FROM mail_connection_checks WHERE user_id=${owner.id}`,
            )
          ).rows[0];
          expect(proof?.consumed_at).not.toBeNull();
          expect(proof?.payload_enc).toBeNull();
          queued.push(id);
          return true;
        },
      },
    );
    expect(saved.ok).toBe(true);
    expect(queued).toHaveLength(1);
    const events = (
      await db.execute(sql`
      SELECT action,outcome,metadata FROM auth_security_events WHERE actor_id=${owner.id}
    `)
    ).rows;
    expect(events).toContainEqual(
      expect.objectContaining({ action: "mailbox.connected", outcome: "success" }),
    );
    expect(JSON.stringify(events)).not.toMatch(
      /synthetic-never-in-audit|mail\.example\.test|password|token/i,
    );
  });
});
