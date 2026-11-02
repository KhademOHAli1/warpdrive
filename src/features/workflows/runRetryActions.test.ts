import { beforeEach, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  csrf: vi.fn(),
  context: vi.fn(),
  retry: vi.fn(),
  nudge: vi.fn(),
}));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: deps.csrf }));
vi.mock("@/server/trpc/context", () => ({ createContext: deps.context }));
vi.mock("./runRetry", () => ({ retryWorkflowRun: deps.retry }));
vi.mock("./worker", () => ({ nudgeWorkflowRun: deps.nudge }));

import { retryWorkflowAction } from "./actions";

beforeEach(() => vi.resetAllMocks());

it("rejects CSRF before resolving requester context or touching the retry", async () => {
  deps.csrf.mockResolvedValue({ ok: false, error: "invalid_csrf" });
  expect(await retryWorkflowAction({}, "wrong")).toEqual({ ok: false, error: "E_WORKFLOW_001" });
  expect(deps.context).not.toHaveBeenCalled();
  expect(deps.retry).not.toHaveBeenCalled();
});

it.each(["missing", "foreign"] as const)(
  "requires the real context's %s native session to match the actor",
  async (cause) => {
    deps.csrf.mockResolvedValue({ ok: true, value: true });
    deps.context.mockResolvedValue({
      db: null,
      actor: { id: "actor" },
      session: cause === "missing" ? null : { userId: "other", sessionId: "session" },
    });
    expect(await retryWorkflowAction({}, "valid")).toEqual({ ok: false, error: "E_WORKFLOW_001" });
    expect(deps.retry).not.toHaveBeenCalled();
    expect(deps.nudge).not.toHaveBeenCalled();
  },
);

it("passes only context-owned identity and nudges only after the durable result", async () => {
  deps.csrf.mockResolvedValue({ ok: true, value: true });
  const session = { userId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const db = { trusted: true };
  const input = {
    runId: crypto.randomUUID(),
    failureId: crypto.randomUUID(),
    requestKey: crypto.randomUUID(),
  };
  deps.context.mockResolvedValue({ db, actor: { id: session.userId }, session });
  let commit: ((value: { ok: true; value: { id: string; replayed: boolean } }) => void) | undefined;
  deps.retry.mockImplementation(
    () =>
      new Promise((resolve) => {
        commit = resolve;
      }),
  );
  const pending = retryWorkflowAction(input, "valid");
  await vi.waitFor(() => expect(deps.retry).toHaveBeenCalledOnce());
  expect(deps.retry.mock.calls[0]?.slice(0, 3)).toEqual([db, session, input]);
  expect(deps.nudge).not.toHaveBeenCalled();
  if (commit === undefined) throw new Error("Retry not started");
  commit({ ok: true, value: { id: input.runId, replayed: false } });
  expect(await pending).toEqual({ ok: true, value: { id: input.runId } });
  expect(deps.nudge).toHaveBeenCalledExactlyOnceWith(input.runId);
});

it("does not enqueue a rejected generation", async () => {
  deps.csrf.mockResolvedValue({ ok: true, value: true });
  deps.context.mockResolvedValue({
    db: null,
    actor: { id: "actor" },
    session: { userId: "actor", sessionId: "native" },
  });
  deps.retry.mockResolvedValue({ ok: false, error: "E_WORKFLOW_003" });
  expect(await retryWorkflowAction({}, "valid")).toEqual({ ok: false, error: "E_WORKFLOW_003" });
  expect(deps.nudge).not.toHaveBeenCalled();
});
