import { expect, test } from "vitest";
import { nativeStageMoveInput, nativeStageReadInput } from "./nativeStageTypes";

const input = {
  protocolVersion: 1,
  expectedActorId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  dealId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pipelineId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  toStageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  expectedWriteVersion: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  beforePosition: null,
  afterPosition: null,
};
test("native contract normalizes UUID case and requires a database-owned revision", () => {
  expect(nativeStageMoveInput.parse(input).expectedActorId).toBe(
    input.expectedActorId.toLowerCase(),
  );
  expect(
    nativeStageMoveInput.safeParse({ ...input, expectedWriteVersion: undefined }).success,
  ).toBe(false);
  expect(
    nativeStageMoveInput.safeParse({ ...input, expectedUpdatedAt: "2026-11-02T00:00:00Z" }).success,
  ).toBe(false);
});
test.each([
  { beforePosition: "NaN" },
  { afterPosition: "Infinity" },
  { beforePosition: "1", afterPosition: "0" },
  { beforePosition: "9999999999999999999999999999999" },
  { protocolVersion: 2 },
  { actor: { type: "admin" } },
])("rejects unsafe rank/protocol/authority input %j", (change) => {
  expect(nativeStageMoveInput.safeParse({ ...input, ...change }).success).toBe(false);
});
test("read-only recovery accepts no stage, token or mutating fields", () => {
  const read = { protocolVersion: 1, expectedActorId: input.expectedActorId, dealId: input.dealId };
  expect(nativeStageReadInput.safeParse(read).success).toBe(true);
  expect(nativeStageReadInput.safeParse({ ...read, toStageId: input.toStageId }).success).toBe(
    false,
  );
});
