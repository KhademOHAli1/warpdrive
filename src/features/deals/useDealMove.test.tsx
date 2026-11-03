// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { moveNativeDealStageAction, readNativeDealStageAction } from "./nativeStageAction";
import type { NativeStageMoveResult } from "./nativeStageTypes";
import { clearStageMove, readStageMove } from "./retainedStageMove";
import { useDealMove } from "./useDealMove";

vi.mock("./nativeStageAction", () => ({
  moveNativeDealStageAction: vi.fn(),
  readNativeDealStageAction: vi.fn(),
}));
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pipeline = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const input = {
  dealId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  toStageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  expectedWriteVersion: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  beforePosition: null,
  afterPosition: null,
};
const deal = {
  id: input.dealId,
  pipelineId: pipeline,
  stageId: input.toStageId,
  status: "open" as const,
  writeVersion: "11111111-1111-4111-8111-111111111111",
  updatedAt: "2026-11-02T12:00:00.000Z",
  boardPosition: "1",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function wrapper(client: QueryClient, id = actor) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <NativeActorProvider key={id} actorId={id}>
        {children}
      </NativeActorProvider>
    </QueryClientProvider>
  );
}
function setup(reload = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined), id = actor) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["board", pipeline], { cards: [{ id: input.dealId, stageId: "old" }] });
  return {
    client,
    reload,
    hook: renderHook(() => useDealMove(pipeline, reload), { wrapper: wrapper(client, id) }),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  document.cookie = "wd_csrf=stage-test-token";
});
afterEach(() => {
  cleanup();
  for (const id of [actor, other]) {
    const saved = readStageMove(id);
    if (saved) clearStageMove(id, saved.id);
  }
});

test("pending native move keeps the authoritative cache and blocks a second dispatch", async () => {
  const response = deferred<NativeStageMoveResult>();
  vi.mocked(moveNativeDealStageAction).mockReturnValue(response.promise);
  const { client, reload, hook } = setup();
  const before = client.getQueryData(["board", pipeline]);
  act(() => {
    hook.result.current.move(input);
    hook.result.current.move(input);
  });
  expect(moveNativeDealStageAction).toHaveBeenCalledTimes(1);
  expect(moveNativeDealStageAction).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedActorId: actor,
      expectedWriteVersion: input.expectedWriteVersion,
      pipelineId: pipeline,
    }),
    expect.anything(),
  );
  expect(client.getQueryData(["board", pipeline])).toBe(before);
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    response.resolve({ ok: true, deal });
    await response.promise;
  });
  await waitFor(() => expect(hook.result.current.state).toBeNull());
  expect(reload).toHaveBeenCalledTimes(1);
  expect(hook.result.current.notice).toBe("moved");
});

test("lost response never rolls back newer cache data or resends; explicit recovery is read-only", async () => {
  vi.mocked(moveNativeDealStageAction).mockRejectedValue(new Error("lost after commit"));
  const { client, hook, reload } = setup();
  act(() => {
    hook.result.current.move(input);
  });
  await waitFor(() => expect(hook.result.current.state?.phase).toBe("unknown"));
  const realtime = {
    cards: [{ id: input.dealId, stageId: deal.stageId }, { id: "another-change" }],
  };
  client.setQueryData(["board", pipeline], realtime);
  act(() => {
    hook.result.current.move(input);
  });
  expect(moveNativeDealStageAction).toHaveBeenCalledTimes(1);
  vi.mocked(readNativeDealStageAction).mockResolvedValue({ ok: true, deal });
  await act(async () => {
    await hook.result.current.loadCurrentState();
  });
  expect(readNativeDealStageAction).toHaveBeenCalledWith(
    { protocolVersion: 1, expectedActorId: actor, dealId: input.dealId },
    expect.anything(),
  );
  expect(reload).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(["board", pipeline])).toEqual(realtime);
  expect(hook.result.current.notice).toBe("current");
  expect(hook.result.current.blocked).toBe(false);
});

test("a rejected current-state read or failed Board refresh retains the unknown move", async () => {
  vi.mocked(moveNativeDealStageAction).mockRejectedValue(new Error("lost"));
  const reload = vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("read unavailable"));
  const { hook } = setup(reload);
  act(() => {
    hook.result.current.move(input);
  });
  await waitFor(() => expect(hook.result.current.state?.phase).toBe("unknown"));
  vi.mocked(readNativeDealStageAction).mockResolvedValue({
    ok: false,
    reason: "denied",
    errorId: "E_AUTH_003",
  });
  await act(async () => {
    await hook.result.current.loadCurrentState();
  });
  expect(reload).not.toHaveBeenCalled();
  vi.mocked(readNativeDealStageAction).mockResolvedValue({ ok: true, deal });
  await act(async () => {
    await hook.result.current.loadCurrentState();
  });
  expect(hook.result.current.state?.phase).toBe("unknown");
  expect(hook.result.current.notice).toBe("readFailed");
  expect(hook.result.current.blocked).toBe(true);
});

test("UUID conflict is visible and cannot retry against the stale token", async () => {
  vi.mocked(moveNativeDealStageAction).mockResolvedValue({
    ok: false,
    reason: "conflict",
    errorId: "E_DEAL_002",
  });
  const { hook, reload } = setup();
  act(() => {
    hook.result.current.move(input);
  });
  await waitFor(() => expect(hook.result.current.state?.phase).toBe("conflict"));
  expect(reload).not.toHaveBeenCalled();
  act(() => {
    hook.result.current.move(input);
  });
  expect(moveNativeDealStageAction).toHaveBeenCalledTimes(1);
});

test("acknowledged move plus failed refresh stays confirmed, and missing current deal never resends", async () => {
  vi.mocked(moveNativeDealStageAction).mockResolvedValue({ ok: true, deal });
  const reload = vi
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error("view"))
    .mockResolvedValue(undefined);
  const { hook } = setup(reload);
  act(() => {
    hook.result.current.move(input);
  });
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  expect(hook.result.current.state?.phase).toBe("confirmed");
  vi.mocked(readNativeDealStageAction).mockResolvedValue({ ok: true, deal: null });
  await act(async () => {
    await hook.result.current.loadCurrentState();
  });
  expect(hook.result.current.notice).toBe("unavailable");
  expect(moveNativeDealStageAction).toHaveBeenCalledTimes(1);
});

test("late response after account unmount is retained for its actor and cannot refresh another account", async () => {
  const response = deferred<NativeStageMoveResult>();
  vi.mocked(moveNativeDealStageAction).mockReturnValue(response.promise);
  const first = setup();
  act(() => {
    first.hook.result.current.move(input);
  });
  first.hook.unmount();
  const second = setup(undefined, other);
  await act(async () => {
    response.resolve({ ok: true, deal });
    await response.promise;
  });
  expect(first.reload).not.toHaveBeenCalled();
  expect(second.reload).not.toHaveBeenCalled();
  expect(second.hook.result.current.state).toBeNull();
  expect(readStageMove(actor)?.phase).toBe("confirmed");
  const restored = setup();
  expect(restored.hook.result.current.state?.phase).toBe("confirmed");
});

test("missing UUID token requires reload without calling a timestamp or mutation fallback", async () => {
  const { hook, reload } = setup();
  act(() => {
    hook.result.current.move({ ...input, expectedWriteVersion: "" });
  });
  expect(hook.result.current.notice).toBe("invalid");
  expect(moveNativeDealStageAction).not.toHaveBeenCalled();
  await act(async () => {
    await hook.result.current.loadCurrentState();
  });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(readNativeDealStageAction).not.toHaveBeenCalled();
});
