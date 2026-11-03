// PREPARED_NOT_EXECUTED: postimage retaining all ten error-boundary cases.
// The v2 service is substituted; no database query is issued or faked, and no
// storage proof is claimed. Valid operation IDs keep execution errors reachable.
import { Pool } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import type { executeThreadReadIntent } from "@/features/email/readIntents";
import type { ReadActionValue } from "@/features/email/readIntentTypes";
import type { AppContext } from "@/server/trpc/context";

const operations = vi.hoisted(() => ({
  execute: vi.fn<typeof executeThreadReadIntent>(),
  reconcile: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("@/features/email/readIntents", () => ({
  executeThreadReadIntent: operations.execute,
}));
vi.mock("@/features/email/imapThreadOperationsQueue", () => ({
  reconcileThreadImapOperation: operations.reconcile,
}));
vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ db, actor, session }),
}));

import { markThreadReadAction, markThreadUnreadAction } from "@/features/email/readActions";

const threadId = "2ef5bcf1-7b4f-409c-9db0-5d19b88dac48";
const operationId = "9b5f0fc2-79c0-46ca-9bea-b62c80b60657";
const actor: NonNullable<AppContext["actor"]> = {
  id: "a8657204-9ffd-4acd-b25a-102855412a48",
  type: "regular",
  isActive: true,
  groupIds: new Set(),
  managedUserIds: new Set(),
  flags: new Set(),
  name: "Boundary actor",
  email: "boundary@example.test",
  avatarUrl: null,
};
const session: NonNullable<AppContext["session"]> = {
  userId: actor.id,
  sessionId: "75971729-5015-4e02-bfa1-c7399a1dd770",
};
const actions = [
  { name: "read", action: markThreadReadAction, read: true },
  { name: "unread", action: markThreadUnreadAction, read: false },
] as const;

function confirmedValue(read: boolean): ReadActionValue {
  return {
    threadId,
    readIntent: {
      operationId,
      threadId,
      desiredRead: read,
      state: "applied",
      admitBefore: "2026-11-02T12:00:30.000Z",
    },
  };
}

function expectExecution(read: boolean) {
  expect(operations.execute).toHaveBeenCalledExactlyOnceWith(
    db,
    {
      actor,
      session: { actorId: actor.id, sessionId: session.sessionId },
      threadId,
      operationId,
      read,
    },
    expect.any(AbortSignal),
  );
}

beforeEach(() => {
  operations.execute
    .mockReset()
    .mockImplementation((_database, args) =>
      Promise.resolve({ ok: true, value: confirmedValue(args.read) }),
    );
  operations.reconcile.mockClear();
});
afterAll(async () => {
  const pool: unknown = "$client" in db ? db.$client : undefined;
  if (pool instanceof Pool) await pool.end();
});

it.each(actions)(
  "serializes expected $name write uncertainty as an opaque Result",
  async ({ action, read }) => {
    const failure = new AppError(ERROR_IDS.DB_WRITE_FAILED, "private-commit-receipt", {
      phase: "commit-receipt",
      privateDiagnostic: "private-transaction-details",
    });
    operations.execute.mockRejectedValueOnce(failure);
    await expect(action("csrf", { threadId, operationId })).resolves.toEqual({
      ok: false,
      error: { id: ERROR_IDS.DB_WRITE_FAILED },
    });
    expectExecution(read);
    expect(operations.reconcile).not.toHaveBeenCalled();
  },
);

it.each(actions)(
  "preserves a confirmed $name result without reconciliation",
  async ({ action, read }) => {
    await expect(action("csrf", { threadId, operationId })).resolves.toEqual({
      ok: true,
      value: confirmedValue(read),
    });
    expectExecution(read);
    expect(operations.reconcile).not.toHaveBeenCalled();
  },
);

for (const entry of actions) {
  it.each(["native", "abort", "invariant"] as const)(
    `preserves the identity of a %s rejection at the ${entry.name} boundary`,
    async (kind) => {
      const error =
        kind === "abort"
          ? new DOMException("private-abort-reason", "AbortError")
          : kind === "native"
            ? Object.assign(new Error("private-native-error"), { code: "57014" })
            : new AppError(ERROR_IDS.DB_INVARIANT, "private-programmer-error");
      operations.execute.mockRejectedValueOnce(error);
      await expect(entry.action("csrf", { threadId, operationId })).rejects.toBe(error);
      expectExecution(entry.read);
      expect(operations.reconcile).not.toHaveBeenCalled();
    },
  );
}
