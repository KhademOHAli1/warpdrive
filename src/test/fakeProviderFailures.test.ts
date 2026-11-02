import { assert, expect, test, vi } from "vitest";
import { invokeProvider } from "@/features/integrations/providers/invoke";
import { err } from "@/types/result";
import {
  attemptA,
  connect,
  consent,
  harness,
  redirectUri,
  signal,
} from "./fakeProviderTestFixtures";

test("the explicit fixture clock expires consent codes and access while refresh remains possible", async () => {
  const h = harness();
  const code = await consent(h);
  h.advanceTime(60_001);
  expect(
    await invokeProvider(
      h.adapter,
      "exchange",
      {
        attemptId: attemptA,
        code: code.code,
        redirectUri,
      },
      { signal: signal() },
    ),
  ).toEqual(err({ code: "authorization_expired" }));
  const connected = await connect(h, "account-a", "10000000-0000-4000-8000-000000000003");
  h.advanceTime(60_001);
  expect(
    await invokeProvider(
      h.adapter,
      "check",
      { credential: connected.credential },
      { signal: signal() },
    ),
  ).toEqual(err({ code: "authorization_expired" }));
  expect(
    (
      await invokeProvider(
        h.adapter,
        "refresh",
        { credential: connected.credential },
        { signal: signal() },
      )
    ).ok,
  ).toBe(true);
});

test("one-shot rate limit and outage faults preserve state and recover deterministically", async () => {
  const h = harness();
  const c = await connect(h);
  const options = { signal: signal() };
  h.failNext("check", { kind: "rate_limited", retryAfterMs: 1_234 });
  expect(await invokeProvider(h.adapter, "check", { credential: c.credential }, options)).toEqual(
    err({ code: "rate_limited", retryAfterMs: 1_234 }),
  );
  h.failNext("refresh", { kind: "unavailable" });
  expect(await invokeProvider(h.adapter, "refresh", { credential: c.credential }, options)).toEqual(
    err({ code: "unavailable", outcome: "unknown" }),
  );
  expect((await invokeProvider(h.adapter, "check", { credential: c.credential }, options)).ok).toBe(
    true,
  );
  expect(
    (await invokeProvider(h.adapter, "refresh", { credential: c.credential }, options)).ok,
  ).toBe(true);
});

test.each([false, true])(
  "unknown revocation may have applied=%s without automatic retries",
  async (apply) => {
    const h = harness();
    const c = await connect(h);
    h.failNext("disconnect", { kind: "ambiguous_outcome", apply });
    const options = { signal: signal() };
    expect(
      await invokeProvider(h.adapter, "disconnect", { credential: c.credential }, options),
    ).toEqual(err({ code: "ambiguous_outcome", outcome: "unknown" }));
    expect(h.calls("disconnect")).toBe(1);
    const checked = await invokeProvider(h.adapter, "check", { credential: c.credential }, options);
    expect(checked.ok).toBe(!apply);
    expect(
      await invokeProvider(h.adapter, "disconnect", { credential: c.credential }, options),
    ).toEqual({
      ok: true,
      value: { remoteStatus: apply ? "already_invalid" : "revoked" },
    });
  },
);

test("cancellation while exchange waits does not consume the code or create a usable grant", async () => {
  const h = harness();
  const code = await consent(h);
  const wait = h.holdNext("exchange");
  const controller = new AbortController();
  const reason = new DOMException("Synthetic cancellation", "AbortError");
  const input = { attemptId: attemptA, code: code.code, redirectUri };
  const started = invokeProvider(h.adapter, "exchange", input, { signal: controller.signal });
  const rejected = expect(started).rejects.toBe(reason);
  await wait.started;
  controller.abort(reason);
  await rejected;
  wait.release();
  const retried = await invokeProvider(h.adapter, "exchange", input, { signal: signal() });
  assert(retried.ok);
  expect(h.bindCredential(retried.value.credentialCandidate).ok).toBe(true);
});

test("an already-aborted invocation never enters fixture operations or consumes a queued fault", async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  h.failNext("discoverCapabilities", { kind: "unavailable" });
  await expect(
    invokeProvider(h.adapter, "discoverCapabilities", {}, { signal: controller.signal }),
  ).rejects.toThrow();
  expect(h.calls("discoverCapabilities")).toBe(0);
  expect(await invokeProvider(h.adapter, "discoverCapabilities", {}, { signal: signal() })).toEqual(
    err({ code: "unavailable" }),
  );
});

test("fixture operations perform no network calls", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  try {
    const h = harness();
    const c = await connect(h);
    await invokeProvider(
      h.adapter,
      "listResources",
      { credential: c.credential },
      { signal: signal() },
    );
    await invokeProvider(
      h.adapter,
      "disconnect",
      { credential: c.credential },
      { signal: signal() },
    );
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
