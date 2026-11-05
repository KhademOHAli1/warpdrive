import { expect, it } from "vitest";
import { companyStorageCall } from "./storageDeadline";

it("releases a hung storage wait on abort and disposes a late returned stream", async () => {
  let deliver: ((value: { destroy: () => void }) => void) | undefined;
  let destroyed = 0;
  const source = new Promise<{ destroy: () => void }>((resolve) => {
    deliver = resolve;
  });
  const controller = new AbortController();
  const waiting = companyStorageCall(
    controller.signal,
    () => source,
    (stream) => stream.destroy(),
  );
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  deliver?.({
    destroy() {
      destroyed += 1;
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(destroyed).toBe(1);
});

it("consumes a late storage rejection after deadline without keeping the caller waiting", async () => {
  let fail: ((cause: unknown) => void) | undefined;
  const source = new Promise<void>((_, reject) => {
    fail = reject;
  });
  const controller = new AbortController();
  const waiting = companyStorageCall(controller.signal, () => source);
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  fail?.(new Error("late provider failure"));
  await Promise.resolve();
  await Promise.resolve();
});

it("bounds an unresponsive SDK even when the caller has no deadline", async () => {
  await expect(
    companyStorageCall(
      new AbortController().signal,
      () => new Promise<never>(() => undefined),
      undefined,
      5,
    ),
  ).rejects.toMatchObject({ name: "TimeoutError" });
});
