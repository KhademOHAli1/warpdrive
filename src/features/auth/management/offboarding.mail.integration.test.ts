import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { decryptToken, encryptToken } from "@/features/email/crypto";
import { ok } from "@/types/result";
import { revokeUserAccess } from "./offboarding";

it("offboarding clears every provider credential and only queues real Google revocations", async () => {
  await withTestDb(async (db) => {
    const user = (
      await db.execute(
        sql`INSERT INTO users(email,name) VALUES('offboard@example.com','Offboard') RETURNING id`,
      )
    ).rows[0] as { id: string };
    for (const provider of ["gmail", "imap_smtp", "microsoft"] as const) {
      await db.execute(
        sql`INSERT INTO email_accounts(user_id,email_address,provider,connection_generation,refresh_token_enc,credentials_enc) VALUES(${user.id},${`${provider}@example.com`},${provider},7,${provider === "imap_smtp" ? null : encryptToken(`${provider}-refresh`)},${encryptToken(`${provider}-credentials`)})`,
      );
    }
    await revokeUserAccess(db, user.id, new AbortController().signal);
    const rows = (
      await db.execute(
        sql`SELECT status,refresh_token_enc,credentials_enc,connection_generation FROM email_accounts WHERE user_id=${user.id}`,
      )
    ).rows;
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(row).toEqual({
        status: "disconnected",
        refresh_token_enc: null,
        credentials_enc: null,
        connection_generation: 8,
      });
    const revocations = (
      await db.execute(
        sql`SELECT provider,token_enc FROM auth_integration_revocations WHERE user_id=${user.id}`,
      )
    ).rows as { provider: string; token_enc: Buffer }[];
    expect(revocations).toHaveLength(1);
    expect(revocations[0]?.provider).toBe("google");
    expect(decryptToken(revocations[0]!.token_enc)).toEqual(ok("gmail-refresh"));
    await revokeUserAccess(db, user.id, new AbortController().signal);
    expect(
      (await db.execute(sql`SELECT id FROM auth_integration_revocations WHERE user_id=${user.id}`))
        .rows,
    ).toHaveLength(1);
  });
});

it("records the exact Google revocation on the disconnected mailbox for safe future reconsent", async () => {
  await withTestDb(async (db) => {
    const owner = (
      await db.execute(
        sql`INSERT INTO users(email,name) VALUES('reconsent@example.com','Reconsent') RETURNING id`,
      )
    ).rows[0] as { id: string };
    await db.execute(
      sql`INSERT INTO email_accounts(user_id,email_address,provider,is_default,refresh_token_enc) VALUES(${owner.id},'reconsent@example.com','gmail',true,${encryptToken("previous-refresh")})`,
    );
    await revokeUserAccess(db, owner.id, new AbortController().signal);
    expect(
      (
        await db.execute(
          sql`SELECT a.is_default,r.status FROM email_accounts a JOIN auth_integration_revocations r ON r.id::text=a.connection_settings->>'remoteRevocationId' AND r.user_id=a.user_id WHERE a.user_id=${owner.id}`,
        )
      ).rows,
    ).toEqual([{ is_default: false, status: "pending" }]);
  });
});
