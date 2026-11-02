import { afterEach, expect, expectTypeOf, test, vi } from "vitest";
import { err, ok, type Result } from "@/types/result";
import type { ProviderAdapter, ProviderFailure, ProviderInput, ProviderOutput } from "./contract";
import { invokeProvider } from "./invoke";

const credential = { id: "f030286b-9f21-445c-88ec-de119b3787ce", generation: 1 };
const options = () => ({ signal: new AbortController().signal, timeoutMs: 100 });
const checkValue = { checkedAt: 1000, grantedScopes: ["read"], accountId: "account-one" };
const checkInput = { credential };

function adapter(run: ProviderAdapter["operations"]["check"]): ProviderAdapter {
  return {
    id: "fixture",
    operations: {
      authorize: { mode: "unsupported" },
      exchange: { mode: "unsupported" },
      refresh: { mode: "unsupported" },
      listResources: { mode: "unsupported" },
      check: run,
      disconnect: { mode: "unsupported" },
      discoverCapabilities: { mode: "unsupported" },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("preserves the selected operation's output type and passes its required signal", async () => {
  const run = vi.fn((_input: ProviderInput<"check">, signal: AbortSignal) => {
    expect(signal).toBeInstanceOf(AbortSignal);
    return Promise.resolve(ok(checkValue));
  });
  const result = invokeProvider(
    adapter({ mode: "supported", run }),
    "check",
    checkInput,
    options(),
  );
  expectTypeOf(result).toEqualTypeOf<Promise<Result<ProviderOutput<"check">, ProviderFailure>>>();
  expect(await result).toEqual(ok(checkValue));
  expect(run).toHaveBeenCalledWith(checkInput, expect.any(AbortSignal));
});

test("unsupported operations return a stable failure without pretending to run", async () => {
  expect(
    await invokeProvider(adapter({ mode: "unsupported" }), "check", checkInput, options()),
  ).toEqual(err({ code: "unsupported" }));
});

test("rejects malformed boundary inputs and unbounded timeout settings before adapter I/O", async () => {
  const run = vi.fn(() => Promise.resolve(ok(checkValue)));
  const a = adapter({ mode: "supported", run });
  for (const input of [{ credential: { ...credential, generation: 0 } }, { token: "secret" }])
    expect(await invokeProvider(a, "check", input, options())).toEqual(
      err({ code: "invalid_input" }),
    );
  for (const timeoutMs of [0, -1, Number.POSITIVE_INFINITY, 60_001, 1.5])
    expect(await invokeProvider(a, "check", checkInput, { ...options(), timeoutMs })).toEqual(
      err({ code: "invalid_input" }),
    );
  expect(run).not.toHaveBeenCalled();
});

test("malformed or non-HTTP authorization URLs fail as values without throwing parser details", async () => {
  const a = adapter({ mode: "unsupported" });
  for (const redirectUri of ["not a URL", "javascript:secret", "ftp://provider.example/callback"])
    expect(
      await invokeProvider(
        a,
        "authorize",
        { attemptId: credential.id, state: "state", redirectUri },
        options(),
      ),
    ).toEqual(err({ code: "invalid_input" }));
});

test("validates typed adapter results at the response boundary without returning secret fields", async () => {
  const run = vi.fn(() => Promise.resolve(ok({ ...checkValue, accessToken: "secret" })));
  expect(
    await invokeProvider(adapter({ mode: "supported", run }), "check", checkInput, options()),
  ).toEqual(err({ code: "invalid_response" }));
});

test("preserves safe rate-limit and expired-authorization codes while redacting adapter errors", async () => {
  const run = vi.fn(() =>
    Promise.resolve(
      err({
        code: "rate_limited" as const,
        retryAfterMs: 1000,
        message: "secret",
        headers: { authorization: "secret" },
      }),
    ),
  );
  const a = adapter({ mode: "supported", run });
  expect(await invokeProvider(a, "check", checkInput, options())).toEqual(
    err({ code: "rate_limited", retryAfterMs: 1000 }),
  );
  const expired = adapter({
    mode: "supported",
    run: () =>
      Promise.resolve(
        err({
          code: "authorization_expired" as const,
          message: "secret",
          headers: { authorization: "secret" },
        }),
      ),
  });
  expect(await invokeProvider(expired, "check", checkInput, options())).toEqual(
    err({ code: "authorization_expired" }),
  );
});

test("sanitizes unexpected throws and malformed error envelopes", async () => {
  const run = vi.fn(() => Promise.reject(new TypeError("secret token and callback URL")));
  const a = adapter({ mode: "supported", run });
  expect(await invokeProvider(a, "check", checkInput, options())).toEqual(err({ code: "failed" }));
  const malformed = adapter({
    mode: "supported",
    run: () =>
      Promise.resolve({
        ok: false,
        error: { code: "secret-code", message: "secret" },
      } as unknown as Result<ProviderOutput<"check">, ProviderFailure>),
  });
  expect(await invokeProvider(malformed, "check", checkInput, options())).toEqual(
    err({ code: "invalid_response" }),
  );
});

test("caller abort before start preserves the AbortError and performs no adapter I/O", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Caller cancelled", "AbortError");
  controller.abort(reason);
  const run = vi.fn(() => Promise.resolve(ok(checkValue)));
  await expect(
    invokeProvider(adapter({ mode: "supported", run }), "check", checkInput, {
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect(run).not.toHaveBeenCalled();
});

test("caller abort propagates to a running adapter and discards its noncooperative late result", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Caller cancelled", "AbortError");
  let captured: AbortSignal | undefined;
  let finish: ((value: Result<ProviderOutput<"check">, ProviderFailure>) => void) | undefined;
  const run = vi.fn((_input: ProviderInput<"check">, signal: AbortSignal) => {
    captured = signal;
    return new Promise<Result<ProviderOutput<"check">, ProviderFailure>>((resolve) => {
      finish = resolve;
    });
  });
  const result = invokeProvider(adapter({ mode: "supported", run }), "check", checkInput, {
    signal: controller.signal,
  });
  const rejected = expect(result).rejects.toBe(reason);
  controller.abort(reason);
  await rejected;
  expect(captured?.aborted).toBe(true);
  finish?.(ok(checkValue));
  await Promise.resolve();
});

test("timeout bounds a noncooperative adapter and cleans up all owned timers/listeners", async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, "removeEventListener");
  let captured: AbortSignal | undefined;
  let rejectLate: ((reason: unknown) => void) | undefined;
  const run = vi.fn((_input: ProviderInput<"check">, signal: AbortSignal) => {
    captured = signal;
    return new Promise<Result<ProviderOutput<"check">, ProviderFailure>>((_resolve, reject) => {
      rejectLate = reject;
    });
  });
  const result = invokeProvider(adapter({ mode: "supported", run }), "check", checkInput, {
    signal: caller.signal,
    timeoutMs: 10,
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toEqual(err({ code: "timed_out" }));
  expect(captured?.aborted).toBe(true);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
  rejectLate?.(new TypeError("late secret"));
  await Promise.resolve();
});

test("repeated successful calls leave no timers or caller abort listeners", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const a = adapter({ mode: "supported", run: () => Promise.resolve(ok(checkValue)) });
  for (let i = 0; i < 20; i++)
    expect(await invokeProvider(a, "check", checkInput, { signal: controller.signal })).toEqual(
      ok(checkValue),
    );
  expect(add).toHaveBeenCalledTimes(20);
  expect(remove).toHaveBeenCalledTimes(20);
  expect(vi.getTimerCount()).toBe(0);
});
