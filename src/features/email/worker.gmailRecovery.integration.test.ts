import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { AppError } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { err, ok } from "@/types/result";
import { encryptToken } from "./crypto";
import type { createGmailClient } from "./gmailClient";
import { FakeGmailClient } from "./gmailFake";
import type { makeRefresh } from "./gmailRefresh";
import { countMessages, msg, seedAccount } from "./resyncTestHarness";
import { runSyncJob } from "./worker";

const provider = vi.hoisted(() => ({
  refresh: vi.fn<ReturnType<typeof makeRefresh>>(),
  createClient: vi.fn<typeof createGmailClient>(),
}));

vi.mock("./gmailRefresh", () => ({ makeRefresh: () => provider.refresh }));
vi.mock("./gmailClient", () => ({ createGmailClient: provider.createClient }));

it("retries expired history coverage with the retained Gmail grant", async () => {
  await withTestDb(async (db) => {
    const lastSyncAt = new Date(Date.now() - 60_000);
    const { acctId: accountId } = await seedAccount(db, { startHistoryId: "100", lastSyncAt });
    const refreshToken = "synthetic-worker-refresh-token";
    await db.execute(sql`
      UPDATE email_accounts SET refresh_token_enc=${encryptToken(refreshToken)}
      WHERE id=${accountId}
    `);

    const gmail = new FakeGmailClient();
    const historyList = vi
      .spyOn(gmail, "historyList")
      .mockResolvedValue(err(new AppError("E_GMAIL_001", "expired history", { status: 404 })));
    const listMessages = vi
      .spyOn(gmail, "listMessages")
      .mockResolvedValueOnce(err(new AppError("E_GMAIL_001", "try again", { status: 503 })));
    gmail.listResults = [{ messages: [{ id: "recovered-message", threadId: "recovered-thread" }] }];
    gmail.messages.set(
      "recovered-message",
      msg("recovered-message", "recovered-thread", "sender@example.test"),
    );
    gmail.profileHistoryId = "999";
    provider.refresh.mockResolvedValue(ok({ accessToken: "synthetic-access", expiresIn: 3600 }));
    provider.createClient.mockReturnValue(gmail);

    const readCheckpoint = async () =>
      (
        await db.execute(sql`
          SELECT status, last_history_id, last_error_id,
            last_sync_at > ${lastSyncAt.toISOString()}::timestamptz AS sync_advanced,
            refresh_token_enc IS NOT NULL AS grant_retained
          FROM email_accounts WHERE id=${accountId}
        `)
      ).rows[0];
    const run = () => runSyncJob(db, { accountId, signal: AbortSignal.timeout(15_000) });

    expect(await run()).toMatchObject({
      ok: false,
      error: { id: "E_GMAIL_001", context: { status: 503 } },
    });
    expect(await readCheckpoint()).toEqual({
      status: "error",
      last_history_id: "100",
      last_error_id: "E_GMAIL_001",
      sync_advanced: false,
      grant_retained: true,
    });
    expect(await countMessages(db, accountId)).toBe(0);

    expect(await run()).toEqual(ok({ applied: 1 }));
    expect(provider.refresh.mock.calls.map(([token]) => token)).toEqual([
      refreshToken,
      refreshToken,
    ]);
    expect(historyList.mock.calls.map(([request]) => request.startHistoryId)).toEqual([
      "100",
      "100",
    ]);
    expect(listMessages).toHaveBeenCalledTimes(2);
    expect(await readCheckpoint()).toEqual({
      status: "connected",
      last_history_id: "999",
      last_error_id: null,
      sync_advanced: true,
      grant_retained: true,
    });
    expect(await countMessages(db, accountId)).toBe(1);
  });
});
