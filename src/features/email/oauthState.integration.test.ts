import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { encryptToken } from "./crypto";
import { seedMailHttpSession, syntheticCheckedMailbox } from "./mailConnectionHttp.test-helpers";
import { hashMailboxProof } from "./mailConnectionProofContext";
import { commitMailboxProof, createMailboxProof } from "./mailConnectionProofs";
import { consumeGmailOAuthState, createGmailOAuthState, hashGmailOAuthState } from "./oauthState";

const signal = () => AbortSignal.timeout(10_000);
describe("session-bound Gmail OAuth proofs", () => {
  it("stores encrypted verifier and only a domain-separated state hash; consumes exactly once", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const issued = await createGmailOAuthState(db, f.context, signal());
      if (!issued.ok) throw new Error("expected state");
      const row = (await db.execute(sql`SELECT * FROM mail_connection_checks`)).rows[0];
      expect(JSON.stringify(row)).not.toContain(issued.value.state);
      expect(row?.token_hash).toBe(hashGmailOAuthState(issued.value.state));
      expect(hashGmailOAuthState(issued.value.state)).not.toBe(
        hashMailboxProof(issued.value.state),
      );
      const results = await Promise.all(
        [1, 2].map(() =>
          consumeGmailOAuthState(db, f.context, issued.value.state, issued.value.state, signal()),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const accepted = results.find((r) => r.ok);
      if (!accepted?.ok) throw new Error("expected verifier");
      expect(createHash("sha256").update(accepted.value.verifier).digest("base64url")).toBe(
        issued.value.codeChallenge,
      );
      expect(JSON.stringify(row)).not.toContain(accepted.value.verifier);
      expect(
        (
          await db.execute(
            sql`SELECT payload_enc,consumed_at IS NOT NULL AS consumed FROM mail_connection_checks`,
          )
        ).rows[0],
      ).toMatchObject({ payload_enc: null, consumed: true });
    });
  });

  it("rejects actor/session swapping, cookie mismatch and malformed unicode without consuming the owner's state", async () => {
    await withTestDb(async (db) => {
      const owner = await seedMailHttpSession(db);
      const other = await seedMailHttpSession(db);
      const issued = await createGmailOAuthState(db, owner.context, signal());
      if (!issued.ok) throw new Error("expected state");
      for (const [context, cookie] of [
        [other.context, issued.value.state],
        [owner.context, undefined],
        [owner.context, "ف".repeat(64)],
        [{ ...owner.context, sessionId: other.context.sessionId }, issued.value.state],
      ] as const)
        expect(
          (await consumeGmailOAuthState(db, context, issued.value.state, cookie, signal())).ok,
        ).toBe(false);
      expect(
        (
          await consumeGmailOAuthState(
            db,
            owner.context,
            issued.value.state,
            issued.value.state,
            signal(),
          )
        ).ok,
      ).toBe(true);
    });
  });

  it.each(["expiry", "tamper", "revoked", "stale"])(
    "rejects %s before exchanging any code",
    async (kind) => {
      await withTestDb(async (db) => {
        const f = await seedMailHttpSession(db);
        const issued = await createGmailOAuthState(db, f.context, signal());
        if (!issued.ok) throw new Error("expected state");
        if (kind === "expiry")
          await db.execute(
            sql`UPDATE mail_connection_checks SET expires_at=now()-interval '1 second'`,
          );
        if (kind === "tamper")
          await db.execute(
            sql`UPDATE mail_connection_checks SET payload_enc=${encryptToken("{}")} `,
          );
        if (kind === "revoked")
          await db.execute(
            sql`UPDATE sessions SET revoked_at=now() WHERE id=${f.context.sessionId}`,
          );
        if (kind === "stale")
          await db.execute(
            sql`UPDATE sessions SET fresh_authenticated_at='2000-01-01' WHERE id=${f.context.sessionId}`,
          );
        expect(
          (
            await consumeGmailOAuthState(
              db,
              f.context,
              issued.value.state,
              issued.value.state,
              signal(),
            )
          ).ok,
        ).toBe(false);
      });
    },
  );

  it("rejects IMAP proof cross-use in both directions even if a ledger hash is deliberately remapped", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const gmail = await createGmailOAuthState(db, f.context, signal());
      if (!gmail.ok) throw new Error("expected state");
      await db.execute(
        sql`UPDATE mail_connection_checks SET token_hash=${hashMailboxProof(gmail.value.state)}`,
      );
      expect(
        await commitMailboxProof(
          db,
          f.context,
          { checkId: gmail.value.state, folderPaths: ["INBOX"], historyDays: 90, isDefault: true },
          signal(),
        ),
      ).toEqual({ ok: false, error: "stale_check" });
      await db.execute(sql`DELETE FROM mail_connection_checks`);
      const imap = await createMailboxProof(db, f.context, syntheticCheckedMailbox, signal());
      if (!imap.ok) throw new Error("expected IMAP proof");
      await db.execute(
        sql`UPDATE mail_connection_checks SET token_hash=${hashGmailOAuthState(imap.value.checkId)}`,
      );
      expect(
        await consumeGmailOAuthState(
          db,
          f.context,
          imap.value.checkId,
          imap.value.checkId,
          signal(),
        ),
      ).toEqual({ ok: false, error: "stale_state" });
      expect((await db.execute(sql`SELECT id FROM email_accounts`)).rows).toHaveLength(0);
    });
  });
});
