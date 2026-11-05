import { expect, it } from "vitest";
import { seedUser } from "@/db/testing/factories";
import { applyMigrations } from "./migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "./migrationAdmission.test-helpers";

it("upgrades populated Gmail health from 0108 to 0109 without inventing a last check", async () => {
  const h = await freshMigrationDb();
  let target: Awaited<ReturnType<typeof migrationFolder>> | undefined;
  try {
    await installPrefix(h, 109);
    target = await migrationFolder(110);
    const owner = await seedUser(h.db);
    const lastSyncAt = new Date("2026-11-05T11:12:13.456Z");
    const lastCheckedAt = new Date("2026-11-05T13:14:15.678Z");
    const emailAddress = "gmail-migration@example.test";
    await h.pool.query(
      `INSERT INTO email_accounts
        (user_id, email_address, provider, status, last_history_id, last_sync_at)
       VALUES ($1, $2, 'gmail', 'error', '7025', $3)`,
      [owner.id, emailAddress, lastSyncAt],
    );
    const readMailbox = async () =>
      (
        await h.pool.query(
          `SELECT status, last_history_id, last_sync_at, last_checked_at
           FROM email_accounts WHERE user_id=$1 AND email_address=$2`,
          [owner.id, emailAddress],
        )
      ).rows;
    const expected = {
      status: "error",
      last_history_id: "7025",
      last_sync_at: lastSyncAt,
    };
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(109);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    const admittedLedger = await ledger(h);
    expect(admittedLedger).toHaveLength(110);
    expect(admittedLedger.slice(0, 109)).toEqual(oldLedger);
    expect(await readMailbox()).toEqual([{ ...expected, last_checked_at: null }]);

    await h.pool.query(
      `UPDATE email_accounts SET last_checked_at=$3 WHERE user_id=$1 AND email_address=$2`,
      [owner.id, emailAddress, lastCheckedAt],
    );
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await ledger(h)).toEqual(admittedLedger);
    expect(await readMailbox()).toEqual([{ ...expected, last_checked_at: lastCheckedAt }]);
  } finally {
    try {
      await target?.dispose();
    } finally {
      await h.close();
    }
  }
});
