import { assert, beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok } from "@/types/result";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import {
  authorizeWorkflowExternalEffect,
  claimWorkflowExternalEffect,
  completeWorkflowExternalEffect,
  recoverWorkflowExternalEffect,
  type WorkflowExternalEffect,
  type WorkflowExternalEffectClaim,
  type WorkflowExternalEffectDispatch,
  type WorkflowExternalEffectTx,
} from "./workflowExternalEffect";
import type * as WorkflowHttpRequestModule from "./workflowHttpRequest";
import {
  invokeWorkflowHttpRequest,
  type WorkflowHttpRequestGrant,
  type WorkflowHttpRequestOutcome,
} from "./workflowHttpRequest";
import {
  claimWorkflowHttpRequest,
  dispatchClaimedWorkflowHttpRequest,
  type WorkflowHttpRequestWorkerContext,
  type WorkflowHttpRequestWorkerServices,
} from "./workflowHttpRequestWorker";

vi.mock("./workflowExternalEffect", () => ({
  authorizeWorkflowExternalEffect: vi.fn(),
  claimWorkflowExternalEffect: vi.fn(),
  completeWorkflowExternalEffect: vi.fn(),
  recoverWorkflowExternalEffect: vi.fn(),
}));
vi.mock("./workflowHttpRequest", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkflowHttpRequestModule>()),
  invokeWorkflowHttpRequest: vi.fn(),
}));

const endpoint = "https://api.example.test/orders?from=workflow";
const grant: WorkflowHttpRequestGrant = {
  url: endpoint,
  methods: ["POST"],
  operatorHeaders: { authorization: "fixture-only" },
};
const node: WorkflowNode = {
  id: "http",
  type: "http.request",
  version: 1,
  name: "HTTP Request",
  config: {
    url: { kind: "value", value: endpoint },
    method: "POST",
    response: [{ name: "count", type: "number" }],
  },
};
const definition: WorkflowDefinition = { schemaVersion: 1, nodes: [node], edges: [] };
const now = new Date();
const runId = "bc71d241-c3d0-4a70-a8c3-a3ba10685914";
const actorId = "a6408221-a52d-4465-8973-4b971020b0f8";
const workflowId = "0ed93827-e683-44a9-b2f5-4947c7506574";
const identity = { runId, nodeId: node.id, iterationIndex: -1, kind: "http.request" };
const attemptId = "b49046d6-31a0-4f4c-86e6-b94f03423759";
const digest = "a".repeat(64);
const fakeClaim = { identity, requestDigest: digest, attemptId } as WorkflowExternalEffectClaim;
const pending: WorkflowExternalEffect = {
  ...identity,
  requestDigest: digest,
  attemptId,
  state: "started",
  startedAt: now,
  dispatchAuthorizedAt: null,
  finishedAt: null,
  output: null,
  errorId: null,
};

const tx = {} as WorkflowExternalEffectTx;
const db = {
  transaction: (work: (tx: WorkflowExternalEffectTx) => unknown) => work(tx),
} as unknown as Db;
const actor = {
  id: actorId,
  type: "admin",
  isActive: true,
  flags: new Set<never>(),
  groupIds: new Set<string>(),
} as const;
const workflow = {
  id: workflowId,
  ownerId: actorId,
  name: "Fixture",
  revision: 1,
  draft: definition,
  publishedNumber: 1,
  active: true,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};
const context: WorkflowHttpRequestWorkerContext = {
  tx,
  definition,
  node,
  actor,
  workflowOwnerId: actorId,
  run: {
    id: runId,
    workflowId,
    versionId: "f906f96e-4bce-4f01-bc8f-74eb288cc3f0",
    actorId,
    requestKey: "df416a39-a890-42c5-9f17-de3acbbcf27c",
    mode: "live",
    status: "running",
    trigger: { scope: "global" },
    nextNodeId: node.id,
    iteratorFrame: null,
    resumeAt: null,
    outputs: {},
    errorId: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  },
};
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(recoverWorkflowExternalEffect).mockResolvedValue(ok(null));
  vi.mocked(claimWorkflowExternalEffect).mockImplementation((_tx, claimIdentity, requestDigest) =>
    Promise.resolve(
      ok({
        state: "acquired",
        claim: { ...fakeClaim, identity: claimIdentity, requestDigest },
      }),
    ),
  );
  vi.mocked(authorizeWorkflowExternalEffect).mockImplementation(
    async (_db, claim, reauthorize, abort) => {
      const admitted = await reauthorize({ ...context, node, workflow, signal: abort });
      if (!admitted.ok) return admitted;
      if (claim.requestDigest !== admitted.value.requestDigest)
        return err(ERROR_IDS.WORKFLOW_CONFLICT);
      const dispatch = {
        executionKey: claim.attemptId,
        requestDigest: claim.requestDigest,
        dispatchAuthorizedAt: now,
      } as WorkflowExternalEffectDispatch;
      return ok({ dispatch, value: admitted.value.value });
    },
  );
  vi.mocked(completeWorkflowExternalEffect).mockImplementation((_tx, claim, terminal) =>
    Promise.resolve(
      ok({
        ...pending,
        requestDigest: claim.requestDigest,
        state: terminal.state,
        finishedAt: now,
        output: "output" in terminal ? terminal.output : null,
        errorId: "errorId" in terminal ? terminal.errorId : null,
      }),
    ),
  );
  vi.mocked(invokeWorkflowHttpRequest).mockResolvedValue({
    disposition: "response-received",
    result: ok({ status: 201, "result.count": 3 }),
  });
});

function services() {
  return {
    readGrants: vi.fn<WorkflowHttpRequestWorkerServices["readGrants"]>().mockReturnValue([grant]),
  };
}

async function acquire(provider = services(), input = context) {
  const claimed = await claimWorkflowHttpRequest(input, provider, signal());
  assert(claimed.ok && claimed.value.state === "acquired", JSON.stringify(claimed));
  return claimed.value.claim;
}

it("replans from a fresh grant after acquisition, invokes once, and seals only the typed output", async () => {
  const provider = services();
  const claim = await acquire(provider);
  expect(claim.identity).toEqual(identity);
  expect(JSON.stringify(claim)).not.toContain(endpoint);
  expect(JSON.stringify(claim)).not.toContain("fixture-only");
  expect(invokeWorkflowHttpRequest).not.toHaveBeenCalled();
  const result = await dispatchClaimedWorkflowHttpRequest(db, claim, provider, signal());
  expect(result).toMatchObject({
    ok: true,
    value: { state: "complete", output: { status: 201, "result.count": 3 } },
  });
  expect(provider.readGrants).toHaveBeenCalledTimes(2);
  expect(invokeWorkflowHttpRequest).toHaveBeenCalledTimes(1);
  expect(completeWorkflowExternalEffect).toHaveBeenCalledExactlyOnceWith(
    tx,
    claim,
    {
      state: "complete",
      output: { status: 201, "result.count": 3 },
    },
    expect.any(AbortSignal),
  );
});

it("distinguishes preview, missing grant, and non-admin denial without a dispatch or claim", async () => {
  const provider = services();
  expect(
    await claimWorkflowHttpRequest(
      { ...context, run: { ...context.run, mode: "simulation" } },
      provider,
      signal(),
    ),
  ).toMatchObject({ ok: false, error: { reason: "live_run_required" } });
  expect(
    await claimWorkflowHttpRequest(
      { ...context, actor: { ...actor, type: "regular" } },
      provider,
      signal(),
    ),
  ).toMatchObject({ ok: false, error: { reason: "unauthorized" } });
  expect(provider.readGrants).not.toHaveBeenCalled();
  provider.readGrants.mockReturnValue([]);
  const denied = await claimWorkflowHttpRequest(context, provider, signal());
  expect(denied).toMatchObject({ ok: false, error: { reason: "grant_denied" } });
  expect(JSON.stringify(denied)).not.toContain(endpoint);
  expect(claimWorkflowExternalEffect).not.toHaveBeenCalled();
  expect(invokeWorkflowHttpRequest).not.toHaveBeenCalled();
});

it("observes immutable receipts without replanning or dispatching", async () => {
  const provider = services();
  const effect = {
    ...pending,
    state: "complete",
    output: { status: 204 },
    finishedAt: now,
  } as const;
  vi.mocked(recoverWorkflowExternalEffect).mockResolvedValue(ok(effect));
  expect(await claimWorkflowHttpRequest(context, provider, signal())).toEqual(
    ok({ state: "observed", effect }),
  );
  expect(provider.readGrants).not.toHaveBeenCalled();
  expect(claimWorkflowExternalEffect).not.toHaveBeenCalled();
  expect(invokeWorkflowHttpRequest).not.toHaveBeenCalled();
});

it("seals revoked grants as not sent only when the receipt was never armed", async () => {
  const provider = services();
  const claim = await acquire(provider);
  provider.readGrants.mockReturnValue([]);
  vi.mocked(recoverWorkflowExternalEffect).mockResolvedValue(
    ok({ ...pending, requestDigest: claim.requestDigest }),
  );
  expect(await dispatchClaimedWorkflowHttpRequest(db, claim, provider, signal())).toMatchObject({
    ok: true,
    value: { state: "not_sent", errorId: ERROR_IDS.WORKFLOW_DENIED },
  });
  expect(invokeWorkflowHttpRequest).not.toHaveBeenCalled();
});

it("does not overwrite an already armed claim when duplicate authorization loses", async () => {
  const provider = services();
  const claim = await acquire(provider);
  const armed = { ...pending, requestDigest: claim.requestDigest, dispatchAuthorizedAt: now };
  vi.mocked(authorizeWorkflowExternalEffect).mockResolvedValue(err(ERROR_IDS.WORKFLOW_CONFLICT));
  vi.mocked(recoverWorkflowExternalEffect).mockResolvedValue(ok(armed));
  expect(await dispatchClaimedWorkflowHttpRequest(db, claim, provider, signal())).toEqual(
    ok(armed),
  );
  expect(invokeWorkflowHttpRequest).not.toHaveBeenCalled();
  expect(completeWorkflowExternalEffect).not.toHaveBeenCalled();
});

it("records a received but unpersistable projection as a terminal response failure", async () => {
  const provider = services();
  const claim = await acquire(provider);
  vi.mocked(invokeWorkflowHttpRequest).mockResolvedValue({
    disposition: "response-received",
    result: ok({ status: 200, "result.tooLong": "x".repeat(4097) }),
  });
  expect(await dispatchClaimedWorkflowHttpRequest(db, claim, provider, signal())).toMatchObject({
    ok: true,
    value: { state: "complete", output: null, errorId: ERROR_IDS.WORKFLOW_INVALID },
  });
  expect(invokeWorkflowHttpRequest).toHaveBeenCalledTimes(1);
});

it.each<[WorkflowHttpRequestOutcome["disposition"], WorkflowExternalEffect["state"]]>([
  ["unknown", "unknown"],
  ["not-sent", "not_sent"],
  ["response-received", "complete"],
])("seals %s failures as %s after cancellation without retry", async (disposition, state) => {
  const provider = services();
  const claim = await acquire(provider);
  const controller = new AbortController();
  vi.mocked(invokeWorkflowHttpRequest).mockImplementation(() => {
    controller.abort();
    return Promise.resolve({
      disposition,
      result: err({ id: "private diagnostic", reason: "unavailable" }),
    });
  });
  const result = await dispatchClaimedWorkflowHttpRequest(db, claim, provider, controller.signal);
  expect(result).toMatchObject({
    ok: true,
    value: { state, errorId: ERROR_IDS.WORKFLOW_WRITE_FAILED, output: null },
  });
  expect(invokeWorkflowHttpRequest).toHaveBeenCalledTimes(1);
  expect(completeWorkflowExternalEffect).toHaveBeenCalledTimes(1);
  expect(vi.mocked(completeWorkflowExternalEffect).mock.lastCall?.[3].aborted).toBe(false);
});
