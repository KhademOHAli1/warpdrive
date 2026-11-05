import { beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Result } from "@/types/result";
import type { DraftSimulationReceipt } from "./draftSimulationReceipt";

const deps = vi.hoisted(() => ({
  csrf: vi.fn<
    (token: string | null) => Promise<{ ok: boolean; value?: boolean; error?: string }>
  >(),
  context: vi.fn<() => Promise<{ db: unknown; actor: { id: string } | null }>>(),
  fresh: vi.fn(),
  nudge: vi.fn(),
  simulate:
    vi.fn<
      (
        db: unknown,
        actor: unknown,
        raw: unknown,
        signal: AbortSignal,
      ) => Promise<Result<DraftSimulationReceipt, string>>
    >(),
}));

vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: deps.csrf }));
vi.mock("@/features/identity/actions/fresh", () => ({ requireFreshIdentityAction: deps.fresh }));
vi.mock("@/server/trpc/context", () => ({ createContext: deps.context }));
vi.mock("./draftSimulation", () => ({ simulateWorkflowDraft: deps.simulate }));
vi.mock("./worker", () => ({ nudgeWorkflowRun: deps.nudge }));

import { simulateWorkflowDraftAction } from "./actions";

const workflowId = "b700ce7d-403e-4589-b2cb-34fd74baae22";
const actor = { id: "805b3653-2221-4dc9-a700-408937622d97" };
const db = { boundary: "authenticated draft simulation" };
const input = {
  workflowId,
  recordId: "18c7f4c6-7ea7-49cc-bdcc-96ca5a50cf8a",
  definition: { schemaVersion: 1, nodes: [], edges: [] },
};
const receipt: DraftSimulationReceipt = {
  source: "draft",
  mode: "simulation",
  workflowId,
  definitionDigest: "a".repeat(64),
  testedAt: "2026-11-05T04:00:00.000Z",
  outcome: "completed",
  steps: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  deps.csrf.mockReset().mockResolvedValue({ ok: true, value: true });
  deps.context.mockReset().mockResolvedValue({ db, actor });
  deps.simulate.mockReset().mockResolvedValue({ ok: true, value: receipt });
});

it.each([null, "invalid-token"])(
  "denies a rejected CSRF token (%s) before context or execution",
  async (token) => {
    deps.csrf.mockResolvedValueOnce({ ok: false, error: "csrf_rejected" });

    expect(await simulateWorkflowDraftAction(input, token)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_DENIED,
    });
    expect(deps.csrf).toHaveBeenCalledExactlyOnceWith(token);
    expect(deps.context).not.toHaveBeenCalled();
    expect(deps.simulate).not.toHaveBeenCalled();
    expect(deps.nudge).not.toHaveBeenCalled();
  },
);

it("denies a context without an authenticated actor", async () => {
  deps.context.mockResolvedValueOnce({ db, actor: null });

  expect(await simulateWorkflowDraftAction(input, "csrf")).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_DENIED,
  });
  expect(deps.simulate).not.toHaveBeenCalled();
  expect(deps.nudge).not.toHaveBeenCalled();
});

it("forwards the exact untrusted input and returns the transient receipt without nudging a worker", async () => {
  expect(await simulateWorkflowDraftAction(input, "csrf")).toEqual({ ok: true, value: receipt });
  expect(deps.simulate).toHaveBeenCalledExactlyOnceWith(db, actor, input, expect.any(AbortSignal));
  const call = deps.simulate.mock.calls[0];
  if (call === undefined) throw new Error("Draft service was not called");
  expect(call[2]).toBe(input);
  expect(call[3].aborted).toBe(false);
  expect(deps.nudge).not.toHaveBeenCalled();
  expect(deps.fresh).not.toHaveBeenCalled();
});

it("preserves a known service failure without admitting or nudging a normal run", async () => {
  deps.simulate.mockResolvedValueOnce({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });

  expect(await simulateWorkflowDraftAction(input, "csrf")).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
  expect(deps.simulate).toHaveBeenCalledTimes(1);
  expect(deps.nudge).not.toHaveBeenCalled();
});

it("does not turn an unexpected rejection into an acknowledged run", async () => {
  const error = new Error("Controlled simulation service rejection");
  deps.simulate.mockRejectedValueOnce(error);

  await expect(simulateWorkflowDraftAction(input, "csrf")).rejects.toBe(error);
  expect(deps.nudge).not.toHaveBeenCalled();
});
