import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { registerAuthMailWorker } from "@/features/auth/management/workers";
import { encryptToken } from "./crypto";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";

async function runMaintenance(db: Parameters<typeof registerAuthMailWorker>[1]) {
  let work: (() => Promise<void>) | undefined;
  const boss = {
    createQueue: () => Promise.resolve(),
    schedule: () => Promise.resolve(),
    work: (_queue: string, handler: () => Promise<void>) => {
      work = handler;
      return Promise.resolve();
    },
  } as unknown as PgBoss;
  await registerAuthMailWorker(boss, db);
  if (work === undefined) throw new Error("maintenance handler missing");
  await work();
}

describe("mail proof credential retention", () => {
  it("auth maintenance removes expired credentials from the shared proof ledger", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      await db.execute(
        sql`INSERT INTO mail_connection_checks(token_hash,user_id,session_id,payload_enc,expires_at) VALUES('expired-imap',${f.user.id},${f.context.sessionId},${encryptToken("synthetic-private-imap-password")},now()-interval '1 second')`,
      );
      await runMaintenance(db);
      expect((await db.execute(sql`SELECT id FROM mail_connection_checks`)).rows).toHaveLength(0);
    });
  });

  it.each(["consumed", "revoked", "inactive", "invited", "session_expired", "foreign_session"])(
    "erases %s proof records without waiting for expiry",
    async (kind) => {
      await withTestDb(async (db) => {
        const f = await seedMailHttpSession(db);
        const other = kind === "foreign_session" ? await seedMailHttpSession(db) : undefined;
        await db.execute(
          sql`INSERT INTO mail_connection_checks(token_hash,user_id,session_id,payload_enc,expires_at,consumed_at) VALUES('gmail-proof',${f.user.id},${other?.context.sessionId ?? f.context.sessionId},${encryptToken("synthetic-private-pkce-verifier")},now()+interval '10 minutes',${kind === "consumed" ? new Date() : null})`,
        );
        if (kind === "revoked")
          await db.execute(
            sql`UPDATE sessions SET revoked_at=now() WHERE id=${f.context.sessionId}`,
          );
        if (kind === "inactive")
          await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.user.id}`);
        if (kind === "invited")
          await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${f.user.id}`);
        if (kind === "session_expired")
          await db.execute(
            sql`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=${f.context.sessionId}`,
          );
        await runMaintenance(db);
        expect((await db.execute(sql`SELECT id FROM mail_connection_checks`)).rows).toHaveLength(0);
      });
    },
  );

  it("preserves unconsumed current-session proofs for both purposes", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      for (const purpose of ["imap", "gmail_oauth"])
        await db.execute(
          sql`INSERT INTO mail_connection_checks(token_hash,user_id,session_id,payload_enc,expires_at) VALUES(${purpose},${f.user.id},${f.context.sessionId},${encryptToken(purpose)},now()+interval '10 minutes')`,
        );
      await runMaintenance(db);
      expect(
        (await db.execute(sql`SELECT token_hash FROM mail_connection_checks ORDER BY token_hash`))
          .rows,
      ).toEqual([{ token_hash: "gmail_oauth" }, { token_hash: "imap" }]);
    });
  });
});
