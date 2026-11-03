// Preserve seven native action cases against the canonical migrated read-intent schema.
import { randomBytes } from "node:crypto";
import { expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { authUsers, sessions } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { lockDeliveryObservationSession } from "@/features/email/deliveryObservationAuthority";
import type * as MailRuntimeModule from "@/features/email/mailConnectionRuntime";
import { hydrateOwner } from "@/features/email/syncCursor";
import type { AuthUser } from "@/features/permissions/types";

const state = vi.hoisted(() => ({
  db: null as Db | null,
  actor: null as AuthUser | null,
  session: null as { userId: string; sessionId: string } | null,
  runtime: null as MailRuntimeModule.ImapConnectionRuntime | null,
  csrf: true,
}));
vi.mock("@/db/client", () => ({
  get db() {
    if (state.db === null) throw new AppError(ERROR_IDS.DB_INVARIANT, "Test database unavailable");
    return state.db;
  },
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () =>
    Promise.resolve({ db: state.db, actor: state.actor, session: state.session }),
}));
vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: () =>
    Promise.resolve(state.csrf ? { ok: true } : { ok: false, error: { id: "E_PERM_001" } }),
}));
vi.mock("@/features/email/mailConnectionRuntime", async (original) => {
  const actual = await original<typeof MailRuntimeModule>();
  return {
    ...actual,
    loadImapConnection: () => {
      if (state.runtime === null)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Fixture runtime unavailable");
      return Promise.resolve({ ok: true, value: state.runtime });
    },
  };
});

import { imapOperationsFixture } from "@/features/email/imapThreadOperations.test-helpers";

const queued = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("@/features/email/queueMailboxSync", () => ({
  queueMailboxSync: (...args: unknown[]) => queued(...(args as [])),
}));

import {
  listThreadMoveFoldersAction,
  moveThreadAction,
} from "@/features/email/imapThreadOperationsActions";

async function bindNativeOwner(
  db: Db,
  owner: Awaited<ReturnType<typeof seedUser>>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  await db.insert(authUsers).values({
    id: owner.id,
    email: owner.email,
    name: owner.name,
    emailVerified: true,
    twoFactorEnabled: owner.isAdmin,
  });
  signal.throwIfAborted();
  const now = new Date();
  const [session] = await db
    .insert(sessions)
    .values({
      userId: owner.id,
      tokenHash: hashSessionCredential(randomBytes(32).toString("base64url")),
      authMethod: "password",
      assurance: owner.isAdmin ? "mfa" : "password",
      freshAuthenticatedAt: now,
      mfaVerifiedAt: owner.isAdmin ? now : null,
      lastSeenAt: now,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
    })
    .returning({ id: sessions.id });
  signal.throwIfAborted();
  if (session === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Native owner session missing");
  const actor = await hydrateOwner(db, owner.id, signal);
  if (!actor.ok) throw actor.error;
  expect(
    await db.transaction((tx) =>
      lockDeliveryObservationSession(tx, { actorId: owner.id, sessionId: session.id }, signal),
    ),
  ).toBe(true);
  state.actor = actor.value;
  state.session = { userId: owner.id, sessionId: session.id };
}

it.each(["csrf", "unauthenticated", "invalid", "stranger"] as const)(
  "rejects unsafe move requests before provider access (%s)",
  async (kind) => {
    await withTestDb(async (db) => {
      state.db = db;
      const f = await imapOperationsFixture(db);
      try {
        state.actor = f.actor;
        state.runtime = f.runtime;
        state.csrf = kind !== "csrf";
        if (kind === "unauthenticated") state.actor = null;
        if (kind === "stranger")
          state.actor = { ...f.actor, id: (await seedUser(db)).id, type: "admin" };
        const before = f.server.authenticationAttempts();
        const result = await moveThreadAction("csrf", {
          threadId: f.threadId,
          destinationPath: kind === "invalid" ? "bad\r\npath" : "Archiv",
        });
        expect(result.ok).toBe(false);
        expect(f.server.authenticationAttempts()).toBe(before);
      } finally {
        state.csrf = true;
        state.actor = null;
        state.session = null;
        state.runtime = null;
        await f.server.close();
        state.db = null;
      }
    });
  },
);

it("runs owner folder discovery and move through the actual server action with native TLS and PostgreSQL", async () => {
  await withTestDb(async (db) => {
    state.db = db;
    const f = await imapOperationsFixture(db);
    try {
      state.actor = f.actor;
      state.runtime = f.runtime;
      state.csrf = true;
      f.runtime.folderPaths = ["INBOX", "Archiv"];
      expect(await listThreadMoveFoldersAction("csrf", { threadId: f.threadId })).toMatchObject({
        ok: true,
        value: { folders: expect.any(Array) },
      });
      expect(
        await moveThreadAction("csrf", { threadId: f.threadId, destinationPath: "Archiv" }),
      ).toMatchObject({ ok: true, value: { threadId: f.threadId } });
      expect(f.server.state.folders.get("Archiv")?.messages).toHaveLength(2);
    } finally {
      state.actor = null;
      state.session = null;
      state.runtime = null;
      await f.server.close();
      state.db = null;
    }
  });
});

it("dispatches the existing Delete server action to native IMAP without a Gmail token", async () => {
  await withTestDb(async (db) => {
    state.db = db;
    const f = await imapOperationsFixture(db);
    try {
      state.actor = f.actor;
      state.runtime = f.runtime;
      state.csrf = true;
      const { trashThreadAction } = await import("@/features/email/actions");
      expect(await trashThreadAction("csrf", { threadId: f.threadId })).toMatchObject({
        ok: true,
        value: { threadId: f.threadId },
      });
      expect(f.server.state.folders.get("Trash")?.messages).toHaveLength(2);
    } finally {
      state.actor = null;
      state.session = null;
      state.runtime = null;
      await f.server.close();
      state.db = null;
    }
  });
});

it("queues verification after an ambiguous owner read without blindly issuing another STORE", async () => {
  await withTestDb(async (db) => {
    state.db = db;
    const f = await imapOperationsFixture(db);
    try {
      await bindNativeOwner(db, f.owner, f.signal);
      state.runtime = f.runtime;
      state.csrf = true;
      queued.mockClear();
      const { prepareThreadReadIntentAction } = await import("@/features/email/readIntentActions");
      const prepared = await prepareThreadReadIntentAction("csrf", {
        threadId: f.threadId,
        read: true,
      });
      expect(prepared).toMatchObject({
        ok: true,
        value: {
          kind: "created",
          readIntent: {
            threadId: f.threadId,
            desiredRead: true,
            state: "prepared",
          },
        },
      });
      if (!prepared.ok || prepared.value.kind !== "created")
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Native IMAP read was not prepared");
      f.server.state.dropMutationResponse = "STORE";
      const { markThreadReadAction } = await import("@/features/email/readActions");
      expect(
        await markThreadReadAction("csrf", {
          threadId: f.threadId,
          operationId: prepared.value.readIntent.operationId,
        }),
      ).toMatchObject({ ok: false, error: { id: "E_MAIL_008" } });
      expect(queued).toHaveBeenCalledWith(f.accountId, expect.any(AbortSignal));
      expect(f.server.state.commands.filter((command) => command === "STORE")).toHaveLength(1);
    } finally {
      state.actor = null;
      state.session = null;
      state.runtime = null;
      await f.server.close();
      state.db = null;
    }
  });
});
