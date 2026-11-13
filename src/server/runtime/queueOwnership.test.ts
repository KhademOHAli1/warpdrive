import { describe, expect, it, vi } from "vitest";
import { createQueueOperationTracker } from "./queueOwnership";

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: () => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = () => {
      fail(new Error("sensitive vendor failure"));
    };
  });
  return { promise, resolve, reject };
}

describe("actual queue startup ownership", () => {
  it("holds real pending operations and includes work registered while draining", async () => {
    const tracker = createQueueOperationTracker(vi.fn());
    const first = deferred(),
      second = deferred();
    tracker.observe(first.promise, "admission");
    let drained = false;
    const waiting = tracker.waitForSettled().then(() => {
      drained = true;
    });
    tracker.observe(second.promise, "query");
    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);
    second.resolve();
    await waiting;
    expect(tracker.snapshot()).toEqual({ pending: 0, cleanupUnknown: false });
  });

  it("settles failed SQL while notifying the owner without sensitive arguments", async () => {
    const failed = vi.fn();
    const tracker = createQueueOperationTracker(failed),
      actual = deferred();
    tracker.observe(actual.promise, "query");
    actual.reject();
    await tracker.waitForSettled();
    expect(failed).toHaveBeenCalledExactlyOnceWith();
    expect(tracker.snapshot()).toEqual({ pending: 0, cleanupUnknown: false });
  });

  it.each(["reader-close", "producer-stop"] as const)(
    "retains unknown %s cleanup rather than claiming drained",
    async (phase) => {
      const tracker = createQueueOperationTracker(() => {
          throw new Error("sink");
        }),
        actual = deferred();
      tracker.observe(actual.promise, phase);
      let drained = false;
      void tracker.waitForSettled().then(() => {
        drained = true;
      });
      actual.reject();
      await Promise.resolve();
      await Promise.resolve();
      expect(drained).toBe(false);
      expect(tracker.snapshot()).toEqual({ pending: 1, cleanupUnknown: true });
    },
  );
});
