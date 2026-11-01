import { expect, test, vi } from "vitest";
import { waitForRequest } from "./ownRequestFormModel";

test.each([false, true])(
  "a non-Error abort reason is a static AbortError (already aborted: %s)",
  async (alreadyAborted) => {
    const controller = new AbortController();
    if (alreadyAborted) controller.abort("PRIVATE-abort-reason");
    const pending = Promise.resolve().then(() =>
      waitForRequest(new Promise<never>(() => undefined), controller.signal),
    );
    if (!alreadyAborted)
      await Promise.resolve().then(() => controller.abort("PRIVATE-abort-reason"));
    await expect(pending).rejects.toBeInstanceOf(DOMException);
    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "The request was interrupted.",
    });
  },
);

test("a non-Error transport failure becomes a static error", async () => {
  const controller = new AbortController();
  const pending = waitForRequest(
    vi.fn<() => Promise<never>>().mockRejectedValue("PRIVATE-transport-reason")(),
    controller.signal,
  );
  await expect(pending).rejects.toBeInstanceOf(DOMException);
  await expect(pending).rejects.toMatchObject({
    name: "OperationError",
    message: "The request failed.",
  });
});
