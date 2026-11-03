import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { setUserActive } from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { getThread } from "./emailReads";
import { checkMailboxConnection } from "./mailConnectionCheck";
import { commitMailboxProof } from "./mailConnectionCommit";
import { mutateMailboxConnection } from "./mailConnectionMutations";
import { hashMailboxProof } from "./mailConnectionProofContext";
import { prepareThreadReadIntent, reconcileThreadReadIntent } from "./readIntentLifecycle";
import type { SoftMailbox } from "./readIntentSoftLifecycleConnection.test-helpers";
import { softSignal } from "./readIntentSoftLifecycleConnection.test-helpers";
import type { SoftData } from "./readIntentSoftLifecycleData.test-helpers";
import { expectSoftPreserved, snapshotSoftData } from "./readIntentSoftLifecycleData.test-helpers";
import type { SoftReadOperation } from "./readIntentSoftLifecycleState.test-helpers";
import { loadReadIntent } from "./readIntentStore";
import { executeThreadReadIntent } from "./readIntents";
import { trashThread } from "./threadTrash";

export type SoftLifecycleFixture = SoftMailbox & SoftData & SoftReadOperation;
export type SoftLifecycleFlow = "disconnect" | "deactivate" | "reconnect" | "trash";

interface AccountObservation {
  id: string;
  status: string;
  paused: boolean;
  is_default: boolean;
  display_name: string | null;
  connection_generation: number;
  credential_version: number;
  credentials: string | null;
  refresh_token: string | null;
  settings: unknown;
}

async function accountObservation(db: Db, id: string): Promise<AccountObservation> {
  const [row] = (
    await db.execute(sql`SELECT id,status,paused,is_default,display_name,connection_generation,
    credential_version,encode(credentials_enc,'hex') AS credentials,
    encode(refresh_token_enc,'hex') AS refresh_token,connection_settings AS settings
    FROM email_accounts WHERE id=${id}`)
  ).rows as unknown as AccountObservation[];
  if (!row) throw new AppError(ERROR_IDS.DB_INVARIANT, "Soft lifecycle account disappeared");
  return row;
}

async function disconnect(db: Db, f: SoftLifecycleFixture) {
  expect(
    await mutateMailboxConnection(
      db,
      f.context,
      { accountId: f.accountId, action: "disconnect" },
      softSignal(),
      { enqueueSync: null },
    ),
  ).toEqual({ ok: true, value: undefined });
}

async function deactivate(db: Db, f: SoftLifecycleFixture) {
  const admin: PermSetUser = {
    id: f.adminId,
    type: "admin",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
  expect(
    await setUserActive(db, admin, { userId: f.actor.id, isActive: false }, softSignal()),
  ).toEqual({ ok: true, value: true });
  const [row] = (
    await db.execute(sql`SELECT
    (SELECT is_active FROM users WHERE id=${f.actor.id}) AS active,
    (SELECT count(*)::int FROM sessions WHERE user_id=${f.actor.id}) AS session_count,
    (SELECT count(*)::int FROM sessions WHERE user_id=${f.actor.id} AND revoked_at IS NOT NULL) AS revoked_sessions,
    (SELECT count(*)::int FROM oauth_access_tokens WHERE user_id=${f.actor.id} AND revoked_at IS NOT NULL) AS revoked_access,
    (SELECT count(*)::int FROM oauth_refresh_tokens WHERE user_id=${f.actor.id} AND revoked_at IS NOT NULL) AS revoked_refresh,
    (SELECT count(*)::int FROM oauth_auth_codes WHERE user_id=${f.actor.id} AND consumed_at IS NOT NULL) AS consumed_codes`)
  ).rows;
  expect(row).toEqual({
    active: false,
    session_count: 1,
    revoked_sessions: 1,
    revoked_access: 1,
    revoked_refresh: 1,
    consumed_codes: 1,
  });
}

async function reconnect(db: Db, f: SoftLifecycleFixture) {
  const checked = await checkMailboxConnection(
    db,
    f.context,
    { ...f.input, accountId: f.accountId, displayName: "Reconnected lifecycle owner" },
    softSignal(),
    { policy: f.policy },
  );
  expect(checked.ok).toBe(true);
  if (!checked.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, `Real reconnect check failed: ${checked.error}`);
  const input = {
    checkId: checked.value.checkId,
    folderPaths: ["INBOX"],
    historyDays: 90,
    isDefault: true,
  };
  const beforeEnqueues = f.enqueues();
  const committed = await commitMailboxProof(db, f.context, input, softSignal(), {
    enqueueSync: f.enqueueSync,
  });
  expect(committed).toMatchObject({ ok: true, value: { id: f.accountId } });
  expect(f.enqueues()).toBe(beforeEnqueues + 1);
  expect(
    await commitMailboxProof(db, f.context, input, softSignal(), { enqueueSync: f.enqueueSync }),
  ).toEqual({ ok: false, error: "stale_check" });
  const [proof] = (
    await db.execute(sql`SELECT payload_enc,consumed_at FROM mail_connection_checks
    WHERE token_hash=${hashMailboxProof(checked.value.checkId)}`)
  ).rows;
  expect(proof).toMatchObject({ payload_enc: null });
  expect(proof?.consumed_at).not.toBeNull();
  const [count] = (
    await db.execute(sql`SELECT count(*)::int AS count FROM email_accounts
    WHERE user_id=${f.actor.id}`)
  ).rows;
  expect(count?.count).toBe(1);
}

async function trash(db: Db, f: SoftLifecycleFixture) {
  const before = await snapshotSoftData(db, f);
  const inbox = f.imap.state.folders.get("INBOX");
  if (!inbox) throw new AppError(ERROR_IDS.DB_INVARIANT, "Real protocol Inbox missing");
  const remoteBefore = inbox.messages.map((message) => ({
    uid: message.uid,
    source: message.source.toString("base64"),
  }));
  inbox.readOnly = true;
  try {
    expect(
      await trashThread(db, { actor: f.actor, threadId: f.threadId }, softSignal(), f.deps),
    ).toMatchObject({ ok: false, error: { id: ERROR_IDS.MAIL_CAPABILITY_DENIED } });
    expect(
      inbox.messages.map((message) => ({
        uid: message.uid,
        source: message.source.toString("base64"),
      })),
    ).toEqual(remoteBefore);
    expect(f.imap.state.folders.get("Trash")?.messages).toHaveLength(0);
    expectSoftPreserved(before, await snapshotSoftData(db, f));
    const [failed] = (
      await db.execute(sql`SELECT trashed_at,remote_trashed_at
      FROM email_threads WHERE id=${f.threadId}`)
    ).rows;
    expect(failed).toEqual({ trashed_at: null, remote_trashed_at: null });
  } finally {
    inbox.readOnly = false;
  }
  expect(
    await trashThread(db, { actor: f.actor, threadId: f.threadId }, softSignal(), f.deps),
  ).toMatchObject({ ok: true, value: { threadId: f.threadId } });
  const moved = f.imap.state.folders.get("Trash")?.messages;
  expect(moved).toHaveLength(1);
  expect(moved?.[0]?.source.toString("base64")).toBe(
    remoteBefore.find((message) => message.uid === 2)?.source,
  );
  expect(inbox.messages.map((message) => message.uid)).not.toContain(2);
  expect(f.imap.state.commands).not.toContain("EXPUNGE");
  const [thread] = (
    await db.execute(sql`SELECT trashed_at,remote_trashed_at
    FROM email_threads WHERE id=${f.threadId}`)
  ).rows;
  expect(thread?.trashed_at).not.toBeNull();
  expect(thread?.remote_trashed_at).not.toBeNull();
  const [locators] = (
    await db.execute(sql`SELECT count(*)::int AS count
    FROM mail_message_locators l JOIN email_messages m ON m.id=l.message_id
    WHERE m.thread_id=${f.threadId} AND l.active=true`)
  ).rows;
  expect(locators?.count).toBe(0);
  expect(
    await getThread(db, { actor: f.actor, threadId: f.threadId, allowRemote: false }, softSignal()),
  ).toMatchObject({ ok: false, error: { id: ERROR_IDS.GMAIL_THREAD_NOT_FOUND } });
}

export async function applySoftLifecycle(db: Db, f: SoftLifecycleFixture, flow: SoftLifecycleFlow) {
  const before = await accountObservation(db, f.accountId);
  expect(before.credentials).not.toBeNull();
  switch (flow) {
    case "disconnect":
      await disconnect(db, f);
      break;
    case "deactivate":
      await deactivate(db, f);
      break;
    case "reconnect":
      await reconnect(db, f);
      break;
    case "trash":
      await trash(db, f);
      break;
  }
  const after = await accountObservation(db, f.accountId);
  expect(after.id).toBe(before.id);
  if (flow === "disconnect" || flow === "deactivate") {
    expect(after).toMatchObject({
      status: "disconnected",
      paused: false,
      is_default: false,
      credentials: null,
      refresh_token: null,
      connection_generation: before.connection_generation + 1,
      credential_version: before.credential_version + 1,
    });
  } else if (flow === "reconnect") {
    expect(after).toMatchObject({
      status: "connected",
      paused: false,
      is_default: true,
      display_name: "Reconnected lifecycle owner",
      connection_generation: before.connection_generation + 1,
      credential_version: before.credential_version,
    });
    expect(after.credentials).not.toBeNull();
    expect(after.credentials).not.toBe(before.credentials);
  } else expect(after).toEqual(before);
}

function expectRecordedReadResult(
  result: Awaited<ReturnType<typeof executeThreadReadIntent>>,
  f: SoftLifecycleFixture,
) {
  if (f.state === "applied")
    expect(result).toMatchObject({
      ok: true,
      value: { readIntent: { operationId: f.operationId, state: "applied" } },
    });
  else
    expect(result).toMatchObject({
      ok: false,
      error: {
        id:
          f.state === "denied"
            ? ERROR_IDS.MAIL_CAPABILITY_DENIED
            : f.state === "cancelled"
              ? ERROR_IDS.MAIL_CONNECTION_CHANGED
              : ERROR_IDS.MAIL_WRITE_UNKNOWN,
      },
    });
}

export async function probeRetainedSoftIntent(
  db: Db,
  f: SoftLifecycleFixture,
  flow: SoftLifecycleFlow,
) {
  const loads = f.runtimeLoads();
  const stores = f.stores();
  const args = {
    actor: f.actor,
    session: f.context,
    threadId: f.threadId,
    operationId: f.operationId,
  };
  const key = { actorId: f.actor.id, threadId: f.threadId, operationId: f.operationId };
  const before = await loadReadIntent(db, key, softSignal());
  expect(before?.state).toBe(f.state);
  if (flow === "deactivate") {
    expect(await prepareThreadReadIntent(db, { ...args, read: true }, softSignal())).toMatchObject({
      ok: false,
    });
    expect(
      await executeThreadReadIntent(db, { ...args, read: true }, softSignal(), f.deps),
    ).toMatchObject({ ok: false });
    expect(await reconcileThreadReadIntent(db, args, softSignal())).toMatchObject({ ok: false });
    expect(await loadReadIntent(db, key, softSignal())).toEqual(before);
  } else if (f.state === "prepared" && flow === "trash") {
    expect(await reconcileThreadReadIntent(db, args, softSignal())).toMatchObject({
      ok: true,
      value: { operationId: f.operationId, state: "cancelled" },
    });
    expect(await loadReadIntent(db, key, softSignal())).toMatchObject({
      state: "cancelled",
      dispatchClaim: null,
    });
    const cancelled = await loadReadIntent(db, key, softSignal());
    expect(
      await executeThreadReadIntent(db, { ...args, read: true }, softSignal(), f.deps),
    ).toMatchObject({ ok: false, error: { id: ERROR_IDS.MAIL_CONNECTION_CHANGED } });
    expect(await loadReadIntent(db, key, softSignal())).toEqual(cancelled);
  } else if (f.state === "prepared") {
    expect(
      await executeThreadReadIntent(db, { ...args, read: true }, softSignal(), f.deps),
    ).toMatchObject({ ok: false, error: { id: ERROR_IDS.MAIL_CONNECTION_CHANGED } });
    expect(await loadReadIntent(db, key, softSignal())).toMatchObject({
      state: "denied",
      dispatchClaim: null,
      operationId: f.operationId,
    });
    const denied = await loadReadIntent(db, key, softSignal());
    expect(await reconcileThreadReadIntent(db, args, softSignal())).toMatchObject({
      ok: true,
      value: { operationId: f.operationId, state: "denied" },
    });
    expect(await loadReadIntent(db, key, softSignal())).toEqual(denied);
  } else {
    if (f.state === "admitted" || f.state === "unknown") {
      expect(
        await prepareThreadReadIntent(db, { ...args, read: true }, softSignal()),
      ).toMatchObject({
        ok: true,
        value: { kind: "blocked", readIntent: { operationId: f.operationId, state: f.state } },
      });
    }
    const result = await executeThreadReadIntent(db, { ...args, read: true }, softSignal(), f.deps);
    expectRecordedReadResult(result, f);
    expect(await loadReadIntent(db, key, softSignal())).toEqual(before);
    expect(await reconcileThreadReadIntent(db, args, softSignal())).toMatchObject({
      ok: true,
      value: { operationId: f.operationId, state: f.state },
    });
    expect(await loadReadIntent(db, key, softSignal())).toEqual(before);
  }
  expect(f.runtimeLoads()).toBe(loads);
  expect(f.stores()).toBe(stores);
}
