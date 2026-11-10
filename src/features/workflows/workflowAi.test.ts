import { assert, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  dispatchWorkflowAi,
  prepareWorkflowAi,
  type WorkflowAiGateway,
  type WorkflowAiGatewayReply,
  type WorkflowAiPlan,
} from "./workflowAi";
import { workflowAiLimits, workflowAiOutputFields } from "./workflowAiContract";

const seams = vi.hoisted(() => ({ proofs: new WeakSet<object>() }));
vi.mock("./workflowExternalEffect", () => ({
  isFreshWorkflowExternalEffectDispatch: (proof: object) => seams.proofs.has(proof),
  consumeWorkflowExternalEffectDispatch: (proof: object) => seams.proofs.delete(proof),
}));

const identity = {
  runId: "00000000-0000-4000-8000-000000000001",
  nodeId: "agent",
  iterationIndex: -1,
  kind: "ai.agent",
};
const textAgent = { prompt: "Summarize this synthetic record.", response: { kind: "text" } };
const structuredAgent = {
  ...textAgent,
  response: {
    kind: "json",
    fields: [
      { name: "summary", type: "text" },
      { name: "rating", type: "number" },
      { name: "complete", type: "boolean" },
    ],
  },
};
const classifyIdentity = { ...identity, nodeId: "classify", kind: "ai.classify" };
const classifier = {
  state: "Synthetic example for evaluation.",
  questions: [
    { kind: "boolean", name: "relevant", question: "Is the record relevant?" },
    {
      kind: "score",
      name: "clarity",
      question: "How clear?",
      criteria: ["Poor", "Good", "Excellent"],
    },
    {
      kind: "choice",
      name: "label",
      question: "Select a label.",
      criteria: ["Needs review", "Ready"],
    },
  ],
};
const answers = {
  relevant: { type: "boolean", probability: 0.25 },
  clarity: { type: "score", score: 1.75 },
  label: { type: "choice", choice: "Needs review" },
};

function reply(raw: unknown): WorkflowAiGatewayReply {
  return { body: new TextEncoder().encode(JSON.stringify(raw)), inputTokens: 20, outputTokens: 8 };
}

function gateway(response = reply({ text: "Synthetic summary." })) {
  return {
    profile: {
      id: "synthetic",
      generation: 1,
      capabilities: [
        "agent.text",
        "agent.json",
        "classify.boolean",
        "classify.score",
        "classify.choice",
      ],
    },
    invoke: vi.fn<WorkflowAiGateway["invoke"]>().mockResolvedValue(response),
  } satisfies WorkflowAiGateway;
}

function plan(backend: WorkflowAiGateway, config: unknown = textAgent, occurrence = identity) {
  const result = prepareWorkflowAi({ identity: occurrence, config }, backend);
  assert(result.ok);
  expect(result.value.requestDigest).toBe(result.value.value.requestDigest);
  return result.value.value;
}

function proof(prepared: WorkflowAiPlan) {
  const result = Object.freeze({ requestDigest: prepared.requestDigest });
  seams.proofs.add(result);
  return result;
}

const signal = () => new AbortController().signal;
const invalidReply = { state: "complete", errorId: ERROR_IDS.WORKFLOW_INVALID };

describe("private workflow AI dispatch", () => {
  it("submits one bounded tool-free request and projects the text response", async () => {
    const backend = gateway();
    const prepared = plan(backend);
    const authorization = proof(prepared);
    await expect(dispatchWorkflowAi(prepared, authorization, backend, signal())).resolves.toEqual({
      state: "complete",
      output: { response: "Synthetic summary." },
    });
    expect(backend.invoke).toHaveBeenCalledExactlyOnceWith(
      {
        kind: "ai.agent",
        config: textAgent,
        maxInputTokens: workflowAiLimits.maxInputTokens,
        maxOutputTokens: workflowAiLimits.maxOutputTokens,
      },
      expect.any(AbortSignal),
    );
    await expect(dispatchWorkflowAi(prepared, authorization, backend, signal())).resolves.toEqual({
      state: "not_sent",
      errorId: ERROR_IDS.WORKFLOW_CONFLICT,
    });
    expect(backend.invoke).toHaveBeenCalledTimes(1);
  });

  it("binds proof to the trusted immutable plan, exact request and occurrence", async () => {
    const backend = gateway();
    const prepared = plan(backend);
    const authorization = proof(prepared);
    const changedPrompt = plan(backend, { ...textAgent, prompt: "A different request." });
    const otherOccurrence = plan(backend, textAgent, { ...identity, iterationIndex: 0 });
    for (const [candidate, claim] of [
      [{ ...prepared }, authorization],
      [prepared, { ...authorization }],
      [changedPrompt, authorization],
      [otherOccurrence, authorization],
    ] as const) {
      await expect(dispatchWorkflowAi(candidate, claim, backend, signal())).resolves.toEqual({
        state: "not_sent",
        errorId: ERROR_IDS.WORKFLOW_CONFLICT,
      });
    }
    expect(backend.invoke).not.toHaveBeenCalled();
    expect(Object.isFrozen(prepared.request.config)).toBe(true);
    await expect(
      dispatchWorkflowAi(prepared, authorization, backend, signal()),
    ).resolves.toHaveProperty("output");
  });

  it("requires a configured gateway and exact capabilities both before claim and before send", async () => {
    const backend = gateway();
    const input = { identity: classifyIdentity, config: classifier };
    const missingBoolean: WorkflowAiGateway = {
      ...backend,
      profile: { ...backend.profile, capabilities: ["classify.score", "classify.choice"] },
    };
    for (const unavailable of [undefined, missingBoolean]) {
      expect(prepareWorkflowAi(input, unavailable)).toEqual({
        ok: false,
        error: ERROR_IDS.WORKFLOW_NOT_READY,
      });
    }
    const prepared = plan(backend, classifier, classifyIdentity);
    const rotated = { ...backend, profile: { ...backend.profile, generation: 2 } };
    for (const unavailable of [undefined, missingBoolean, rotated]) {
      await expect(
        dispatchWorkflowAi(prepared, proof(prepared), unavailable, signal()),
      ).resolves.toEqual({
        state: "not_sent",
        errorId: ERROR_IDS.WORKFLOW_NOT_READY,
      });
    }
    expect(backend.invoke).not.toHaveBeenCalled();
  });

  it("projects only the required typed structured fields and shares their mapping paths", async () => {
    const backend = gateway(reply({ values: { summary: "Good", rating: 2.5, complete: false } }));
    const prepared = plan(backend, structuredAgent);
    expect(workflowAiOutputFields(prepared.request)).toEqual([
      { path: ["response", "summary"], kind: "text" },
      { path: ["response", "rating"], kind: "number" },
      { path: ["response", "complete"], kind: "boolean" },
    ]);
    expect(Object.isFrozen(prepared.request.config)).toBe(true);
    assert(
      prepared.request.kind === "ai.agent" && prepared.request.config.response.kind === "json",
    );
    expect(Object.isFrozen(prepared.request.config.response.fields[0])).toBe(true);
    await expect(dispatchWorkflowAi(prepared, proof(prepared), backend, signal())).resolves.toEqual(
      {
        state: "complete",
        output: { "response.summary": "Good", "response.rating": 2.5, "response.complete": false },
      },
    );
  });

  it("projects calibrated boolean probability, fractional score and an exact authored choice", async () => {
    const backend = gateway(reply({ answers }));
    const prepared = plan(backend, classifier, classifyIdentity);
    expect(workflowAiOutputFields(prepared.request)).toEqual([
      { path: ["answers", "relevant"], kind: "number" },
      { path: ["answers", "clarity"], kind: "number" },
      { path: ["answers", "label"], kind: "text" },
    ]);
    await expect(dispatchWorkflowAi(prepared, proof(prepared), backend, signal())).resolves.toEqual(
      {
        state: "complete",
        output: {
          "answers.relevant": 0.25,
          "answers.clarity": 1.75,
          "answers.label": "Needs review",
        },
      },
    );
  });

  it.each([
    { ...answers, relevant: { type: "boolean", probability: 1.01 } },
    { ...answers, relevant: true },
    { ...answers, clarity: { type: "score", score: 2.01 } },
    { ...answers, label: { type: "choice", choice: "needs review" } },
    { ...answers, label: { type: "choice", choice: "Ready", diagnostics: "raw" } },
  ])("rejects out-of-contract evaluation results", async (invalid) => {
    const backend = gateway(reply({ answers: invalid }));
    const prepared = plan(backend, classifier, classifyIdentity);
    await expect(dispatchWorkflowAi(prepared, proof(prepared), backend, signal())).resolves.toEqual(
      invalidReply,
    );
  });

  it.each([
    { summary: "Good", rating: "2.5", complete: false },
    { summary: "Good", rating: 2.5 },
    { summary: "Good", rating: 2.5, complete: false, extra: "raw" },
    { summary: "Good", rating: 2.5, complete: false, ["__proto__"]: "raw" },
  ])("rejects missing, incorrectly typed, and unexpected structured fields", async (values) => {
    const backend = gateway(reply({ values }));
    const prepared = plan(backend, structuredAgent);
    await expect(dispatchWorkflowAi(prepared, proof(prepared), backend, signal())).resolves.toEqual(
      invalidReply,
    );
  });

  it.each([
    reply({ text: "😀".repeat(workflowAiLimits.responseTextBytes / 4 + 1) }),
    { ...reply({ text: "ok" }), body: new Uint8Array(workflowAiLimits.responseBytes + 1) },
    { ...reply({ text: "ok" }), body: new Uint8Array([0xff]) },
    { ...reply({ text: "ok" }), body: new TextEncoder().encode("not JSON") },
    { ...reply({ text: "ok" }), inputTokens: workflowAiLimits.maxInputTokens + 1 },
    { ...reply({ text: "ok" }), outputTokens: workflowAiLimits.maxOutputTokens + 1 },
  ])("rejects malformed and out-of-budget gateway responses", async (raw) => {
    const backend = gateway(raw);
    const prepared = plan(backend);
    await expect(dispatchWorkflowAi(prepared, proof(prepared), backend, signal())).resolves.toEqual(
      invalidReply,
    );
  });

  it("rejects oversized, tool-bearing and invalid authored configurations before dispatch", () => {
    const backend = gateway();
    const cases = [
      { identity, config: { ...textAgent, tools: ["webSearch"] } },
      {
        identity,
        config: { ...textAgent, prompt: "😀".repeat(workflowAiLimits.inputBytes / 4 + 1) },
      },
      { identity, config: { ...textAgent, prompt: "\uD800" } },
      { identity, config: { ...textAgent, prompt: "\u0001".repeat(workflowAiLimits.inputBytes) } },
      {
        identity,
        config: {
          ...structuredAgent,
          response: { kind: "json", fields: [{ name: "constructor", type: "number" }] },
        },
      },
      {
        identity: classifyIdentity,
        config: { ...classifier, questions: [...classifier.questions, ...classifier.questions] },
      },
      {
        identity: classifyIdentity,
        config: {
          ...classifier,
          questions: [
            { kind: "choice", name: "label", question: "Choose", criteria: ["Ready", "Ready"] },
          ],
        },
      },
      {
        identity: classifyIdentity,
        config: {
          ...classifier,
          questions: Array.from(
            { length: workflowAiLimits.questions + 1 },
            () => classifier.questions[0],
          ),
        },
      },
    ];
    for (const input of cases) {
      expect(prepareWorkflowAi(input, backend)).toEqual({
        ok: false,
        error: ERROR_IDS.WORKFLOW_INVALID,
      });
    }
    expect(backend.invoke).not.toHaveBeenCalled();
  });

  it("leaves proof untouched when already aborted and sanitizes an indeterminate gateway failure", async () => {
    const backend = gateway();
    backend.invoke.mockRejectedValue(new Error("synthetic private provider diagnostic"));
    const prepared = plan(backend);
    const authorization = proof(prepared);
    await expect(
      dispatchWorkflowAi(prepared, authorization, backend, AbortSignal.abort()),
    ).resolves.toEqual({
      state: "not_sent",
      errorId: ERROR_IDS.WORKFLOW_DENIED,
    });
    expect(backend.invoke).not.toHaveBeenCalled();
    await expect(dispatchWorkflowAi(prepared, authorization, backend, signal())).resolves.toEqual({
      state: "unknown",
      errorId: ERROR_IDS.WORKFLOW_NOT_READY,
    });
    expect(backend.invoke).toHaveBeenCalledTimes(1);
  });

  it("ends the wait at the deadline even when the gateway ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      const backend = gateway();
      backend.invoke.mockImplementation(() => new Promise(() => {}));
      const prepared = plan(backend);
      const authorization = proof(prepared);
      const pending = dispatchWorkflowAi(prepared, authorization, backend, signal());
      await vi.advanceTimersByTimeAsync(workflowAiLimits.deadlineMs);
      await expect(pending).resolves.toEqual({
        state: "unknown",
        errorId: ERROR_IDS.WORKFLOW_NOT_READY,
      });
      expect(backend.invoke.mock.calls[0]?.[1].aborted).toBe(true);
      await expect(
        dispatchWorkflowAi(prepared, authorization, backend, signal()),
      ).resolves.toHaveProperty("state", "not_sent");
      expect(backend.invoke).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
