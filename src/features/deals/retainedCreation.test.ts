// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { initialAddDealState } from "./addDealState";
import { nativeDealCreateEnvelopeV1 } from "./nativeCreateIntentV1";
import {
  claimCreationAttempt,
  clearRetainedCreation,
  creationAttemptHeld,
  readRetainedCreation,
  releaseCreationAttempt,
  retainCreation,
  settleRejectedCreation,
} from "./retainedCreation";

const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  key = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  pipeline = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  stage = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
function saved(actorId = a, id = crypto.randomUUID()) {
  const form = { ...initialAddDealState(pipeline, stage), title: "Original", value: "1.0001" };
  return {
    actorId,
    id,
    form,
    currency: "USD",
    valueLocale: "en" as const,
    phase: "unknown" as const,
    uncertain: true,
    input: nativeDealCreateEnvelopeV1.parse({
      protocolVersion: 1,
      expectedActorId: actorId,
      creationOperationId: id,
      deal: { title: form.title, value: form.value, pipelineId: pipeline, stageId: stage },
    }),
  };
}
afterEach(() => {
  for (const actor of [a, b]) {
    const operation = readRetainedCreation(actor);
    if (operation) clearRetainedCreation(actor, operation.id);
  }
});
describe("retained account-bound native intent", () => {
  test("attempt ownership is atomic across instances and old token release cannot unlock a newer attempt", () => {
    const first = claimCreationAttempt(a);
    expect(first).not.toBeNull();
    expect(claimCreationAttempt(a)).toBeNull();
    if (first === null) return;
    releaseCreationAttempt(first);
    const second = claimCreationAttempt(a);
    expect(second).not.toBeNull();
    releaseCreationAttempt(first);
    expect(creationAttemptHeld(a)).toBe(true);
    if (second !== null) releaseCreationAttempt(second);
    expect(creationAttemptHeld(a)).toBe(false);
  });
  test("known creation never regresses and a late negative cannot erase its failed-read recovery", () => {
    const original = saved();
    retainCreation(original);
    const completed = {
      ...original,
      phase: "created" as const,
      deal: { id: pipeline, updatedAt: "2026-11-02T00:00:00.000Z", writeVersion: stage },
    };
    retainCreation(completed);
    retainCreation({ ...original, phase: "unknown" });
    expect(readRetainedCreation(a)?.phase).toBe("created");
    expect(settleRejectedCreation(a, original.id)).toBe(false);
    expect(readRetainedCreation(a)?.phase).toBe("created");
  });
  test("a later negative after transport uncertainty retains the original identity", () => {
    const original = saved();
    retainCreation(original);
    expect(settleRejectedCreation(a, original.id)).toBe(false);
    expect(readRetainedCreation(a)?.id).toBe(original.id);
  });
  test("retains a detached frozen snapshot through dismissal/navigation and caller mutation", () => {
    const source = saved();
    retainCreation(source);
    source.form.title = "Changed";
    source.input.deal.labels.push("Changed");
    const again = readRetainedCreation(a);
    expect(again?.form.title).toBe("Original");
    expect(again?.phase).toBe("unknown");
    expect(again?.id).toBe(source.id);
    expect(Object.isFrozen(again?.form)).toBe(true);
    expect(again && "input" in again ? again.input.deal.labels : null).toEqual([]);
  });
  test("different account cannot read/clear original account's unresolved operation", () => {
    const source = saved();
    retainCreation(source);
    expect(readRetainedCreation(b)).toBeNull();
    clearRetainedCreation(b, key);
    expect(readRetainedCreation(a)?.id).toBe(source.id);
  });
  test("late operation callbacks cannot replace or clear a newer operation for the same actor", () => {
    retainCreation(saved(a, key));
    expect(retainCreation(saved(a, b)).id).toBe(key);
    clearRetainedCreation(a, b);
    expect(readRetainedCreation(a)?.id).toBe(key);
    clearRetainedCreation(a, key);
    retainCreation(saved(a, b));
    clearRetainedCreation(a, key);
    expect(readRetainedCreation(a)?.id).toBe(b);
  });
});
