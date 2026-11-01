import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { applyImapPage } from "./imapApplyPage";
import { prepareImapFolder } from "./imapSyncFolders";
import { prepareImapPage } from "./imapSyncPrepare";
import type { PrivateLocalReadFixture } from "./privateIntakeLocalRead.test-helpers";

// Re-fetch the real TLS message using the actual current folder checkpoint. This
// exercises duplicate intake without fabricating a locator or rewinding a cursor.
export async function replayPrivateLocalReadPage(db: Db, f: PrivateLocalReadFixture) {
  const signal = f.args.signal;
  const inspected = await f.runtime.imap.inspectFolder({ path: "INBOX", signal });
  if (!inspected.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Private local-read folder inspection failed");
  const now = new Date();
  const folder = await prepareImapFolder(
    db,
    f.runtime,
    "INBOX",
    { ...inspected.value, isSentFolder: false },
    now,
    signal,
  );
  if (folder === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Private local-read checkpoint missing");
  const priorFetches = f.imap.state.sourceFetches;
  const read = await f.runtime.imap.readFolder({ path: "INBOX", afterUid: 0, signal });
  if (!read.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Private local-read duplicate fetch failed");
  expect(read.value.messages.map((message) => message.uid)).toEqual([1]);
  expect(f.imap.state.sourceFetches).toBeGreaterThan(priorFetches);
  const prepared = await prepareImapPage(f.accountId, read.value, signal);
  expect(await applyImapPage(db, f.runtime, folder, prepared, now, signal)).toMatchObject({
    applied: 0,
    stale: false,
  });
}
