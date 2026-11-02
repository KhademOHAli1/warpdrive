import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import {
  type MailSessionFixtureOptions,
  seedMailHttpSession,
  syntheticCheckedMailbox,
} from "./mailConnectionHttp.test-helpers";
import { commitMailboxProof, createMailboxProof } from "./mailConnectionProofs";

const signal = () => AbortSignal.timeout(15_000);
const denied: readonly [string, MailSessionFixtureOptions][] = [
  ["pendingMFA", { assurance: "pending" }],
  ["administrator password", { isAdmin: true }],
  ["unverified", { emailVerified: false }],
  ["inactive", { isActive: false }],
  ["stale password proof", { freshAt: new Date(Date.now() - 600_000) }],
  [
    "stale MFA proof",
    { assurance: "mfa", twoFactorEnabled: true, mfaAt: new Date(Date.now() - 600_000) },
  ],
  ["idle session", { lastSeenAt: new Date(Date.now() - 3_600_000) }],
  ["absolute expired", { createdAt: new Date(Date.now() - 8 * 24 * 3_600_000) }],
];

describe("mailbox grant commit requires current native authority", () => {
  it.each(denied)("never issues a connection proof to %s", async (_name, options) => {
    await withTestDb(async (db) => {
      const fixture = await seedMailHttpSession(db, options);
      const result = await createMailboxProof(
        db,
        fixture.context,
        syntheticCheckedMailbox,
        signal(),
      );
      expect(result.ok).toBe(false);
      expect((await db.execute(sql`SELECT id FROM mail_connection_checks`)).rows).toHaveLength(0);
    });
  });

  it("rechecks a tightened MFA policy after the earlier connection check", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const proof = await createMailboxProof(db, f.context, syntheticCheckedMailbox, signal());
      expect(proof.ok).toBe(true);
      if (!proof.ok) return;
      await db.execute(
        sql`INSERT INTO auth_policies(id,require_mfa_for_all) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET require_mfa_for_all=true`,
      );
      const result = await commitMailboxProof(
        db,
        f.context,
        { checkId: proof.value.checkId, folderPaths: ["INBOX"], historyDays: 90, isDefault: true },
        signal(),
      );
      expect(result.ok).toBe(false);
      expect(
        (await db.execute(sql`SELECT id FROM email_accounts WHERE user_id=${f.user.id}`)).rows,
      ).toHaveLength(0);
      expect(
        (await db.execute(sql`SELECT consumed_at FROM mail_connection_checks`)).rows[0]
          ?.consumed_at,
      ).toBeNull();
    });
  });
});

it("serializes mailbox commit behind an in-flight authentication-policy change", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db);
    const proof = await createMailboxProof(db, f.context, syntheticCheckedMailbox, signal());
    if (!proof.ok) throw new Error("Missing fixture proof");
    let release!: () => void;
    let started!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const updating = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-auth'),hashtext('mcp-grants'))`,
      );
      await tx.execute(
        sql`INSERT INTO auth_policies(id,require_mfa_for_all) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET require_mfa_for_all=true`,
      );
      started();
      await released;
    });
    await ready;
    const saving = commitMailboxProof(
      db,
      f.context,
      { checkId: proof.value.checkId, folderPaths: ["INBOX"], historyDays: 90, isDefault: true },
      signal(),
    );
    try {
      await vi.waitFor(
        async () => {
          const blocked = (
            await db.execute(
              sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory' AND state='active'`,
            )
          ).rows;
          expect(blocked.length).toBeGreaterThan(0);
        },
        { timeout: 2000, interval: 10 },
      );
    } finally {
      release();
      await updating;
    }
    expect((await saving).ok).toBe(false);
    expect(
      (await db.execute(sql`SELECT id FROM email_accounts WHERE user_id=${f.user.id}`)).rows,
    ).toHaveLength(0);
  });
});
