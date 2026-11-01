import { afterEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { requestSlackRead } from "./slackRead";

afterEach(() => vi.useRealTimers());

const token = "synthetic-private-slack-token";
const args = () => ({
  method: "auth.test" as const,
  token,
  signal: new AbortController().signal,
});

it("does not start I/O for an already-aborted caller", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    requestSlackRead({ ...args(), signal: controller.signal, fetcher }),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("composes caller cancellation into fetch and propagates AbortError", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
    receivedSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      receivedSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("Cancelled", "AbortError")),
        { once: true },
      );
    });
  });
  const pending = requestSlackRead({ ...args(), signal: controller.signal, fetcher });
  const stopped = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await stopped;
  expect(receivedSignal?.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("bounds noncooperative fetch and observes a late rejection without exposing its contents", async () => {
  vi.useFakeTimers();
  let rejectLate: ((reason: unknown) => void) | undefined;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise<Response>((_resolve, reject) => {
        rejectLate = reject;
      }),
  );
  let outcome: unknown;
  const pending = requestSlackRead({ ...args(), fetcher }).then((result) => {
    outcome = result;
  });
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(outcome).toEqual({
      ok: false,
      error: {
        reason: "transient_outage",
        providerFailure: { code: "timed_out" },
        legacyErrorId: ERROR_IDS.SLACK_UNAVAILABLE,
      },
    });
  } finally {
    rejectLate?.({ message: token });
    await pending;
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps cancellation active while the response body is being read", async () => {
  const controller = new AbortController();
  const response = Response.json({ ok: true });
  let finishBody: ((value: unknown) => void) | undefined;
  vi.spyOn(response, "json").mockImplementation(
    () =>
      new Promise<unknown>((resolve) => {
        finishBody = resolve;
      }),
  );
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  let error: unknown;
  const pending = requestSlackRead({ ...args(), signal: controller.signal, fetcher }).catch(
    (cause: unknown) => {
      error = cause;
    },
  );
  await Promise.resolve();
  controller.abort();
  for (let turn = 0; turn < 8 && error === undefined; turn++) await Promise.resolve();
  try {
    expect(error).toMatchObject({ name: "AbortError" });
  } finally {
    finishBody?.({ ok: true });
    await pending;
  }
});

it("cancels noncooperative fetch before a late response and never reads that body", async () => {
  const controller = new AbortController();
  let finishFetch: ((value: Response) => void) | undefined;
  const response = Response.json({ ok: true });
  const body = vi.spyOn(response, "json");
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finishFetch = resolve;
      }),
  );
  let error: unknown;
  const pending = requestSlackRead({ ...args(), signal: controller.signal, fetcher }).catch(
    (cause: unknown) => {
      error = cause;
    },
  );
  controller.abort();
  for (let turn = 0; turn < 8 && error === undefined; turn++) await Promise.resolve();
  try {
    expect(error).toMatchObject({ name: "AbortError" });
  } finally {
    finishFetch?.(response);
    await pending;
  }
  expect(body).not.toHaveBeenCalled();
});

it("removes caller listeners and deadline timers after success", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
  expect(await requestSlackRead({ ...args(), signal: controller.signal, fetcher })).toEqual({
    ok: true,
    value: { ok: true },
  });
  for (const call of add.mock.calls.filter(([event]) => event === "abort")) {
    expect(remove).toHaveBeenCalledWith("abort", call[1]);
  }
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["fetch", "body", "decode", "settlement"] as const)(
  "rejects overdue %s completion even when the deadline timer has not fired",
  async (phase) => {
    vi.useFakeTimers();
    let now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const data = {
      get ok() {
        if (phase === "decode") now = 11_001;
        if (phase === "settlement")
          queueMicrotask(() => {
            now = 11_001;
          });
        return true;
      },
    };
    const response = Response.json({ ok: true });
    vi.spyOn(response, "json").mockImplementation(() => {
      if (phase === "body") now = 11_001;
      return Promise.resolve(data);
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => {
      if (phase === "fetch") now = 11_001;
      return Promise.resolve(response);
    });
    try {
      // No timer advancement: microtasks can complete before the overdue timer callback.
      expect(await requestSlackRead({ ...args(), fetcher })).toEqual({
        ok: false,
        error: {
          reason: "transient_outage",
          providerFailure: { code: "timed_out" },
          legacyErrorId: ERROR_IDS.SLACK_UNAVAILABLE,
        },
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clock.mockRestore();
    }
  },
);

it.each(["fetch", "body"] as const)(
  "preserves caller AbortError precedence over an overdue %s completion",
  async (phase) => {
    vi.useFakeTimers();
    let now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const controller = new AbortController();
    const stop = () => {
      now = 11_001;
      controller.abort();
    };
    const response = Response.json({ ok: true });
    vi.spyOn(response, "json").mockImplementation(() => {
      if (phase === "body") stop();
      return Promise.resolve({ ok: true });
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => {
      if (phase === "fetch") stop();
      return Promise.resolve(response);
    });
    try {
      await expect(
        requestSlackRead({ ...args(), signal: controller.signal, fetcher }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clock.mockRestore();
    }
  },
);
