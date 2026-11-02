// @vitest-environment node
// Synthetic context and mocked domain command: this verifies the action boundary only,
// not session authentication, database authority reloads, or native transport behavior.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/db/client";
import type { Deal } from "@/db/schema/deals";
import { guardCsrf } from "@/features/identity/actions/shared";
import type { HydratedActor } from "@/server/hydrateActor";
import { type AppContext, createContext } from "@/server/trpc/context";
import { moveDeal } from "./dealActions";
import { dealClientFixture, FIRST_DEAL_VERSION, SECOND_DEAL_VERSION } from "./dealClientFixture";
import { moveDealAction } from "./moveAction";
import { notifyOnDealMove } from "./notifyHelpers";
import type { DealMoveInput } from "./schemas";

const afterCallbacks: (() => unknown)[] = [];
const boundaryOrder: string[] = [];

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback);
  },
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: vi.fn() }));
vi.mock("@/server/trpc/context", () => ({ createContext: vi.fn() }));
vi.mock("./dealActions", () => ({ moveDeal: vi.fn() }));
vi.mock("./notifyHelpers", () => ({ notifyOnDealMove: vi.fn() }));

const actor: HydratedActor = {
  id: "10000000-0000-4000-8000-000000000001",
  type: "regular",
  isActive: true,
  name: "Synthetic actor",
  email: "synthetic@example.test",
  avatarUrl: null,
  flags: new Set(),
  groupIds: new Set(),
  managedUserIds: new Set(),
};
const nativeSession: NonNullable<AppContext["session"]> = {
  userId: actor.id,
  sessionId: "20000000-0000-4000-8000-000000000001",
};
const forgedSession: NonNullable<AppContext["session"]> = {
  userId: actor.id,
  sessionId: "20000000-0000-4000-8000-000000000099",
};
const input: DealMoveInput = {
  dealId: "30000000-0000-4000-8000-000000000001",
  toStageId: "40000000-0000-4000-8000-000000000002",
  beforePosition: null,
  afterPosition: null,
  expectedWriteVersion: FIRST_DEAL_VERSION,
};
const finalSnapshot = dealClientFixture({
  id: input.dealId,
  stageId: input.toStageId,
  ownerId: actor.id,
  writeVersion: SECOND_DEAL_VERSION,
});
const finalDeal: Deal = {
  ...finalSnapshot,
  updatedAt: new Date(finalSnapshot.updatedAt),
};

let context: AppContext;

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  boundaryOrder.length = 0;
  context = { db, actor, session: nativeSession };
  vi.mocked(guardCsrf).mockImplementation(() => {
    boundaryOrder.push("csrf");
    return Promise.resolve<Awaited<ReturnType<typeof guardCsrf>>>({ ok: true, value: true });
  });
  vi.mocked(createContext).mockImplementation(() => {
    boundaryOrder.push("context");
    return Promise.resolve(context);
  });
  vi.mocked(moveDeal).mockImplementation(() => {
    boundaryOrder.push("move");
    // Exercise the real allowlisted client serializer even if an internal result has
    // extra private identity fields. These are deliberately absent from the Deal DTO.
    const internalResult = {
      ...finalDeal,
      nativeSession,
      sessionId: nativeSession.sessionId,
    };
    return Promise.resolve<Awaited<ReturnType<typeof moveDeal>>>({
      ok: true,
      value: internalResult,
    });
  });
});

describe("moveDealAction private native session boundary", () => {
  test("forwards only the server context session and returns the opaque client snapshot", async () => {
    const result = await Reflect.apply(moveDealAction, undefined, [input, "csrf", forgedSession]);

    expect(boundaryOrder).toEqual(["csrf", "context", "move"]);
    expect(guardCsrf).toHaveBeenCalledWith("csrf");
    expect(moveDeal).toHaveBeenCalledTimes(1);
    const call = vi.mocked(moveDeal).mock.calls[0];
    expect(call).toHaveLength(5);
    expect(call?.[0]).toBe(db);
    expect(call?.[1]).toBe(actor);
    expect(call?.[2]).toBe(input);
    expect(call?.[3]).toBeInstanceOf(AbortSignal);
    expect(call?.[4]).toBe(nativeSession);
    expect(call?.[4]).not.toBe(forgedSession);
    expect(result).toEqual({ ok: true, deal: finalSnapshot });
    expect(JSON.stringify(result)).not.toContain(nativeSession.sessionId);
    expect(JSON.stringify(result)).not.toContain(forgedSession.sessionId);
    expect(afterCallbacks).toHaveLength(1);
    expect(notifyOnDealMove).not.toHaveBeenCalled();
  });

  test("refuses a null native session before the domain command or deferred notification", async () => {
    context = { db, actor, session: null };

    const result = await Reflect.apply(moveDealAction, undefined, [input, "csrf", forgedSession]);

    expect(result).toEqual({ ok: false, error: { id: "E_AUTH_003" } });
    expect(boundaryOrder).toEqual(["csrf", "context"]);
    expect(guardCsrf).toHaveBeenCalledWith("csrf");
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(moveDeal).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
    expect(notifyOnDealMove).not.toHaveBeenCalled();
  });
});
