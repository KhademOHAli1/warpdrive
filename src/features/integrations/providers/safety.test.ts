import { afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@/types/result";
import type { ProviderAdapter, ProviderFailure, ProviderOperation } from "./contract";
import { invokeProvider } from "./invoke";

const credential = { id: "f030286b-9f21-445c-88ec-de119b3787ce", generation: 1 };
const checkValue = { checkedAt: 1000, grantedScopes: ["read"], accountId: "account-one" };
const mutations = ["exchange", "refresh", "disconnect"] as const;
const uncertainCodes = [
  "timed_out",
  "unavailable",
  "failed",
  "invalid_response",
  "ambiguous_outcome",
] as const;
const rejectedCodes = [
  "unsupported",
  "invalid_input",
  "authorization_expired",
  "forbidden",
  "rate_limited",
] as const;

function input(operation: ProviderOperation): unknown {
  return operation === "exchange"
    ? {
        attemptId: credential.id,
        code: "synthetic-code",
        redirectUri: "http://localhost:3150/callback",
      }
    : { credential };
}

function fixture(code: ProviderFailure["code"]): ProviderAdapter {
  const run = () => Promise.resolve(err({ code }));
  return {
    id: "fixture",
    operations: {
      authorize: { mode: "unsupported" },
      exchange: { mode: "supported", run },
      refresh: { mode: "supported", run },
      listResources: { mode: "unsupported" },
      check: { mode: "supported", run },
      disconnect: { mode: "supported", run },
      discoverCapabilities: { mode: "unsupported" },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test.each(mutations)(
  "%s normalizes uncertain adapter-returned failures to unknown external outcomes",
  async (operation) => {
    for (const code of uncertainCodes)
      expect(
        await invokeProvider(fixture(code), operation, input(operation), {
          signal: new AbortController().signal,
        }),
      ).toEqual(err({ code, outcome: "unknown" }));
  },
);

test.each(mutations)(
  "%s keeps an explicit provider rejection distinct from uncertain delivery",
  async (operation) => {
    for (const code of rejectedCodes)
      expect(
        await invokeProvider(fixture(code), operation, input(operation), {
          signal: new AbortController().signal,
        }),
      ).toEqual(err({ code }));
  },
);

test("read-only checks do not turn network uncertainty into an ambiguous external mutation", async () => {
  for (const code of uncertainCodes.filter((value) => value !== "ambiguous_outcome"))
    expect(
      await invokeProvider(fixture(code), "check", input("check"), {
        signal: new AbortController().signal,
      }),
    ).toEqual(err({ code }));
});

test.each(["handler", "response validation"])(
  "absolute deadline discards an overdue %s result before a delayed timer fires",
  async (phase) => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const a = fixture("failed");
    let captured: AbortSignal | undefined;
    a.operations.check = {
      mode: "supported",
      run: (_input, signal) => {
        captured = signal;
        if (phase === "handler") now = 25;
        return Promise.resolve(
          ok({
            ...checkValue,
            get grantedScopes() {
              if (phase === "response validation") now = 25;
              return ["read"];
            },
          }),
        );
      },
    };
    expect(
      await invokeProvider(a, "check", input("check"), {
        signal: new AbortController().signal,
        timeoutMs: 5,
      }),
    ).toEqual(err({ code: "timed_out" }));
    expect(captured?.aborted).toBe(true);
  },
);

test("aborting from a valid input getter prevents adapter startup and preserves the caller AbortError", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Caller cancelled", "AbortError");
  const run = vi.fn(() => Promise.resolve(ok(checkValue)));
  const a = fixture("failed");
  a.operations.check = { mode: "supported", run };
  await expect(
    invokeProvider(
      a,
      "check",
      {
        get credential() {
          controller.abort(reason);
          return credential;
        },
      },
      { signal: controller.signal },
    ),
  ).rejects.toBe(reason);
  expect(run).not.toHaveBeenCalled();
});

test("input validation that exhausts the deadline performs no provider effect", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const run = vi.fn(() => Promise.resolve(ok({ remoteStatus: "revoked" as const })));
  const a = fixture("failed");
  a.operations.disconnect = { mode: "supported", run };
  expect(
    await invokeProvider(
      a,
      "disconnect",
      {
        get credential() {
          now = 25;
          return credential;
        },
      },
      { signal: new AbortController().signal, timeoutMs: 5 },
    ),
  ).toEqual(err({ code: "timed_out" }));
  expect(run).not.toHaveBeenCalled();
});

test("a throwing input getter becomes a safe invalid-input result before adapter startup", async () => {
  const run = vi.fn(() => Promise.resolve(ok(checkValue)));
  const a = fixture("failed");
  a.operations.check = { mode: "supported", run };
  expect(
    await invokeProvider(
      a,
      "check",
      {
        get credential() {
          throw new TypeError("secret callback URL");
        },
      },
      { signal: new AbortController().signal },
    ),
  ).toEqual(err({ code: "invalid_input" }));
  expect(run).not.toHaveBeenCalled();
});
