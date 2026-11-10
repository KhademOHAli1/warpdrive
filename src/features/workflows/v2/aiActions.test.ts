import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import type { BlockOutput } from "@/features/blocks/contracts";
import { ok } from "@/types/result";
import { executeWorkflowAi } from "./aiActions";
import { safeWorkflowHttpRequest } from "./httpTransport";

vi.mock("./httpTransport", () => ({ safeWorkflowHttpRequest: vi.fn() }));
vi.mock("@/features/email/crypto", () => ({
  decryptToken: () => ({ ok: true, value: "synthetic-fixture-key" }),
}));

const runtime = {
  aiApiKey: Buffer.from("encrypted-fixture"),
  aiBaseUrl: "https://workflow-model.example.test/v1/",
  aiDefaultModel: "enabled-model",
  aiModels: ["enabled-model"],
  internalEndpoints: [],
};
const signal = () => AbortSignal.timeout(1000);
const transport = vi.mocked(safeWorkflowHttpRequest);
function database() {
  const read = () => ({ from: () => ({ where: () => Promise.resolve([runtime]) }) });
  return { select: read } as unknown as Db;
}

function providerAnswer(content: string) {
  transport.mockResolvedValue(
    ok({ status: 200, headers: {}, body: { choices: [{ message: { content } }] } }),
  );
}

describe("workflow AI execution boundary", () => {
  beforeEach(() => transport.mockReset());

  it("runs the agent against the configured model and returns its text result", async () => {
    providerAnswer("Prepared follow-up");
    const runSignal = signal();
    expect(
      await executeWorkflowAi(
        database(),
        "AI_AGENT",
        {
          instructions: "Summarize",
          prompt: "Sample deal",
        },
        runSignal,
      ),
    ).toEqual(ok({ text: "Prepared follow-up" }));
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      {
        url: "https://workflow-model.example.test/v1/chat/completions",
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-fixture-key",
          "content-type": "application/json",
        },
        body: {
          model: "enabled-model",
          messages: [
            { role: "system", content: "Summarize" },
            { role: "user", content: "Sample deal" },
          ],
        },
      },
      runSignal,
      { policy: { internalEndpoints: [] } },
    );
  });

  it("projects Boolean, choice, and score answers and rejects a mismatched response", async () => {
    const config: BlockOutput = {
      input: "Sample response",
      questions: [
        { key: "qualified", type: "boolean", instructions: "Meets criteria?" },
        { key: "tier", type: "choice", choices: ["standard", "premium"] },
        { key: "score", type: "score", min: 0, max: 5 },
      ],
    };
    const expected = { qualified: true, tier: "premium", score: 4 };
    providerAnswer(JSON.stringify(expected));
    expect(await executeWorkflowAi(database(), "CLASSIFY", config, signal())).toEqual(ok(expected));
    expect(transport.mock.calls[0]?.[0].body).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          schema: {
            required: ["qualified", "tier", "score"],
            additionalProperties: false,
          },
        },
      },
    });
    providerAnswer(JSON.stringify({ ...expected, score: 6 }));
    expect(await executeWorkflowAi(database(), "CLASSIFY", config, signal())).toEqual({
      ok: false,
      error: { id: "E_WORKFLOW_BLOCK_OUTPUT", outcome: "unknown" },
    });
  });

  it("rejects a model outside the workspace allowlist before calling the provider", async () => {
    expect(
      await executeWorkflowAi(database(), "AI_AGENT", { providerModel: "other-model" }, signal()),
    ).toEqual({ ok: false, error: { id: "E_WORKFLOW_AI_MODEL" } });
    expect(transport).not.toHaveBeenCalled();
  });
});
