// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { env } from "@/config/env";
import { CSRF_COOKIE } from "@/features/auth/csrf";
import { createContext } from "@/server/trpc/context";

const headers = new Map<string, string>(),
  cookies = new Map<string, string>();
const callbacks: (() => unknown)[] = [];
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: (key: string) => headers.get(key.toLowerCase()) ?? null }),
  cookies: () =>
    Promise.resolve({
      get: (key: string) => (cookies.has(key) ? { value: cookies.get(key) } : undefined),
    }),
}));
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    callbacks.push(callback);
  },
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/server/trpc/context", () => ({ createContext: vi.fn() }));
vi.mock("./nativeStage", () => ({ moveNativeDealStage: vi.fn(), readNativeDealStage: vi.fn() }));
vi.mock("./notifyHelpers", () => ({ notifyOnDealMove: vi.fn() }));

import { moveNativeDealStage, readNativeDealStage } from "./nativeStage";
import { moveNativeDealStageAction, readNativeDealStageAction } from "./nativeStageAction";
import { notifyOnDealMove } from "./notifyHelpers";

const who = { userId: "real-server-user", sessionId: "credential-established-session" };
const snapshot = {
  id: "deal",
  pipelineId: "pipeline",
  stageId: "stage",
  status: "open" as const,
  boardPosition: "1",
  writeVersion: "uuid",
  updatedAt: "2026-11-02T00:00:00.000Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  callbacks.length = 0;
  headers.clear();
  cookies.clear();
  headers.set("origin", new URL(env.BASE_URL).origin);
  headers.set("sec-fetch-site", "same-origin");
  cookies.set(CSRF_COOKIE, "csrf");
  vi.mocked(createContext).mockResolvedValue({
    db: {} as never,
    session: who,
    actor: { id: who.userId } as never,
  });
});
test.each([moveNativeDealStageAction, readNativeDealStageAction])(
  "CSRF rejects native entries before context/SQL",
  async (action) => {
    expect(await action({}, null)).toEqual({ ok: false, reason: "denied", errorId: "E_AUTH_CSRF" });
    expect(createContext).not.toHaveBeenCalled();
    expect(moveNativeDealStage).not.toHaveBeenCalled();
    expect(readNativeDealStage).not.toHaveBeenCalled();
  },
);
test("only genuine internal context references reach native service and notification stays deferred", async () => {
  vi.mocked(moveNativeDealStage).mockResolvedValue({ ok: true, deal: snapshot });
  const raw = { expectedActorId: "untrusted-client" };
  expect(await moveNativeDealStageAction(raw, "csrf")).toEqual({ ok: true, deal: snapshot });
  expect(moveNativeDealStage).toHaveBeenCalledWith({}, who, raw, expect.any(AbortSignal));
  expect(notifyOnDealMove).not.toHaveBeenCalled();
  expect(callbacks).toHaveLength(1);
  await callbacks[0]?.();
  expect(notifyOnDealMove).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ actorId: who.userId, deal: snapshot }),
  );
});
test("read-only recovery never calls mutation or notification, including a missing row", async () => {
  vi.mocked(readNativeDealStage).mockResolvedValue({ ok: true, deal: null });
  expect(await readNativeDealStageAction({}, "csrf")).toEqual({ ok: true, deal: null });
  expect(moveNativeDealStage).not.toHaveBeenCalled();
  expect(callbacks).toHaveLength(0);
});
test("a routine context miss denies before native service and deferred effects", async () => {
  vi.mocked(createContext).mockResolvedValue({ db: {} as never, session: null, actor: null });
  expect(await moveNativeDealStageAction({}, "csrf")).toEqual({
    ok: false,
    reason: "denied",
    errorId: "E_AUTH_003",
  });
  expect(moveNativeDealStage).not.toHaveBeenCalled();
  expect(callbacks).toHaveLength(0);
});
