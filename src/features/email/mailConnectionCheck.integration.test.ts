import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { startMailProtocolImap } from "@/test/mailProtocolImap";
import { startMailProtocolSmtp } from "@/test/mailProtocolSmtp";
import { MAIL_PROTOCOL_TEST_CERT } from "@/test/mailProtocolTls";
import { checkMailboxConnection } from "./mailConnectionCheck";
import { commitMailboxProof } from "./mailConnectionProofs";

it("checks real TLS IMAP and SMTP without sending a message, then saves a private mailbox", async () => {
  const imap = await startMailProtocolImap({ readOnly: true });
  const smtp = await startMailProtocolSmtp();
  imap.state.folders.set("Papierkorb", {
    validity: "901",
    readOnly: false,
    messages: [],
    specialUse: "\\Trash",
  });
  imap.state.folders.set("هرزنامه", {
    validity: "902",
    readOnly: false,
    messages: [],
    specialUse: "\\Junk",
  });
  imap.state.folders.set("Trash", { validity: "903", readOnly: false, messages: [] });
  try {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      await db.execute(
        sql`INSERT INTO auth_users(id,email,name,email_verified) VALUES(${user.id},${user.email},${user.name},true)`,
      );
      const context = { actorId: user.id, sessionId: randomUUID() };
      await db.execute(sql`
        INSERT INTO sessions (id,user_id,token_hash,expires_at,auth_method,assurance,fresh_authenticated_at)
        VALUES (${context.sessionId},${user.id},${randomUUID()},now()+interval '1 hour','password','password',now())
      `);
      const endpoint = (port: number) => ({
        host: "127.0.0.1",
        port,
        security: "tls" as const,
        username: "owner@mail.test",
        password: "synthetic-password",
      });
      const policy = {
        internalEndpoints: [
          {
            protocol: "imaps" as const,
            host: "127.0.0.1",
            port: imap.endpoint.port,
            allowLoopback: true,
            ca: MAIL_PROTOCOL_TEST_CERT,
          },
          {
            protocol: "smtps" as const,
            host: "127.0.0.1",
            port: smtp.endpoint.port,
            allowLoopback: true,
            ca: MAIL_PROTOCOL_TEST_CERT,
          },
        ],
      };
      const input = {
        emailAddress: "owner@mail.test",
        displayName: "فروش · Vertrieb",
        imap: endpoint(imap.endpoint.port),
        smtp: endpoint(smtp.endpoint.port),
      };
      const checked = await checkMailboxConnection(
        db,
        context,
        input,
        AbortSignal.timeout(30_000),
        { policy },
      );
      expect(checked.ok).toBe(true);
      if (!checked.ok) return;
      expect(checked.value.folders.map((folder) => folder.path)).not.toContain("Papierkorb");
      expect(checked.value.folders.map((folder) => folder.path)).not.toContain("هرزنامه");
      expect(checked.value.folders.map((folder) => folder.path)).toContain("Trash");
      expect(checked.value.folders).toContainEqual(
        expect.objectContaining({ path: "INBOX", readOnly: true }),
      );
      expect(smtp.received).toHaveLength(0);
      expect(imap.state.sourceFetches).toBe(0);
      const saved = await commitMailboxProof(
        db,
        context,
        {
          checkId: checked.value.checkId,
          folderPaths: ["INBOX", "Sent"],
          historyDays: 90,
          isDefault: true,
        },
        AbortSignal.timeout(10_000),
      );
      expect(saved.ok).toBe(true);
      expect(JSON.stringify(saved)).not.toContain("synthetic-password");
      const duplicate = await checkMailboxConnection(
        db,
        context,
        input,
        AbortSignal.timeout(10_000),
        { policy },
      );
      expect(duplicate).toEqual({ ok: false, error: "duplicate" });
    });
  } finally {
    await imap.close();
    await smtp.close();
  }
});
