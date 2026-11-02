import { expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { AuthUser } from "@/features/permissions/types";
import type * as MailRuntimeModule from "./mailConnectionRuntime";

const state: {
  db: Db | null;
  actor: AuthUser | null;
  runtime: MailRuntimeModule.ImapConnectionRuntime | null;
  csrf: boolean;
} = { db: null, actor: null, runtime: null, csrf: true };
vi.mock("@/db/client", () => ({
  get db() {
    if (state.db === null) throw new Error("Test database unavailable");
    return state.db;
  },
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: state.actor }),
}));
vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: () =>
    Promise.resolve(state.csrf ? { ok: true } : { ok: false, error: { id: "E_PERM_001" } }),
}));
vi.mock("./mailConnectionRuntime", async (original) => {
  const actual = await original<typeof MailRuntimeModule>();
  return {
    ...actual,
    loadImapConnection: () => {
      if (state.runtime === null) throw new Error("Fixture runtime unavailable");
      return Promise.resolve({ ok: true, value: state.runtime });
    },
  };
});

import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";

const queued = vi.fn(() => Promise.resolve(true));
vi.mock("./queueMailboxSync", () => ({
  queueMailboxSync: (...args: unknown[]) => queued(...(args as [])),
}));

import { listThreadMoveFoldersAction, moveThreadAction } from "./imapThreadOperationsActions";

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
      const { trashThreadAction } = await import("./actions");
      expect(await trashThreadAction("csrf", { threadId: f.threadId })).toMatchObject({
        ok: true,
        value: { threadId: f.threadId },
      });
      expect(f.server.state.folders.get("Trash")?.messages).toHaveLength(2);
    } finally {
      state.actor = null;
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
      state.actor = f.actor;
      state.runtime = f.runtime;
      state.csrf = true;
      queued.mockClear();
      f.server.state.dropMutationResponse = "STORE";
      const { markThreadReadAction } = await import("./readActions");
      expect(await markThreadReadAction("csrf", { threadId: f.threadId })).toMatchObject({
        ok: false,
        error: { id: "E_MAIL_008" },
      });
      expect(queued).toHaveBeenCalledWith(f.accountId, expect.any(AbortSignal));
      expect(f.server.state.commands.filter((command) => command === "STORE")).toHaveLength(1);
    } finally {
      state.actor = null;
      state.runtime = null;
      await f.server.close();
      state.db = null;
    }
  });
});
