import { expect, test } from "vitest";
import { pipelineRenameInput } from "./schemas";

const input = {
  pipelineId: "b016190d-f5ba-4c0f-8387-b080c705288a",
  name: "فروش / Vertrieb",
  expectedUpdatedAt: "2026-10-31T14:00:00.123Z",
};

test("rename requires its source revision and rejects injected authority", () => {
  expect(pipelineRenameInput.safeParse(input).success).toBe(true);
  expect(
    pipelineRenameInput.safeParse({ pipelineId: input.pipelineId, name: input.name }).success,
  ).toBe(false);
  expect(
    pipelineRenameInput.safeParse({ ...input, flags: { "pipeline.manage": true } }).success,
  ).toBe(false);
});

test("rename preserves authored mixed text while refusing whitespace-only names", () => {
  expect(pipelineRenameInput.parse(input).name).toBe(input.name);
  expect(pipelineRenameInput.safeParse({ ...input, name: "   " }).success).toBe(false);
});
