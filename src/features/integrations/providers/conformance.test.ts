import { afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@/types/result";
import type { ProviderAdapter, ProviderOperation } from "./contract";
import { invokeProvider } from "./invoke";

const names: ProviderOperation[] = [
  "authorize",
  "exchange",
  "refresh",
  "listResources",
  "check",
  "disconnect",
  "discoverCapabilities",
];
const credential = { id: "f030286b-9f21-445c-88ec-de119b3787ce", generation: 1 };
const candidate = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  tokenType: "Bearer" as const,
  grantedScopes: ["read"],
};
const account = { id: "account-one", displayName: "حساب آزمون" };
const check = { accountId: account.id, checkedAt: 1000, grantedScopes: ["read"] };
const capabilities = {
  operations: names,
  resourceKinds: ["channel" as const],
  upstreamScopes: ["read"],
  pagination: "cursor" as const,
};
const resources = {
  resources: [{ id: "channel-one", name: "آزمون", kind: "channel" as const, selectable: true }],
  nextCursor: "page-two",
};

function fixture(): ProviderAdapter {
  return {
    id: "fixture",
    operations: {
      authorize: {
        mode: "supported",
        run: (input, signal) => {
          signal.throwIfAborted();
          return Promise.resolve(
            ok({
              authorizationUrl: `https://provider.example/authorize?state=${input.state}`,
            }),
          );
        },
      },
      exchange: {
        mode: "supported",
        run: (_input, signal) => {
          signal.throwIfAborted();
          return Promise.resolve(ok({ account, credentialCandidate: candidate }));
        },
      },
      refresh: {
        mode: "supported",
        run: (_input, signal) => {
          signal.throwIfAborted();
          return Promise.resolve(ok({ credentialCandidate: candidate }));
        },
      },
      listResources: {
        mode: "supported",
        run: (_input, signal) => {
          signal.throwIfAborted();
          return Promise.resolve(ok(resources));
        },
      },
      check: {
        mode: "supported",
        run: (_input, signal) => {
          signal.throwIfAborted();
          return Promise.resolve(ok(check));
        },
      },
      disconnect: {
        mode: "supported",
        run: (_input, signal) => {
          signal.throwIfAborted();
          return Promise.resolve(ok({ remoteStatus: "revoked" }));
        },
      },
      discoverCapabilities: {
        mode: "supported",
        run: (_input, signal) => {
          signal.throwIfAborted();
          return Promise.resolve(ok(capabilities));
        },
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test("a deterministic server-side fixture conforms to all seven correlated operation contracts", async () => {
  const a = fixture();
  const options = { signal: new AbortController().signal };
  expect(
    await invokeProvider(
      a,
      "authorize",
      {
        attemptId: credential.id,
        state: "one-use-state",
        redirectUri: "http://localhost:3150/callback",
      },
      options,
    ),
  ).toEqual(ok({ authorizationUrl: "https://provider.example/authorize?state=one-use-state" }));
  expect(
    await invokeProvider(
      a,
      "exchange",
      {
        attemptId: credential.id,
        code: "synthetic-code",
        redirectUri: "http://localhost:3150/callback",
      },
      options,
    ),
  ).toEqual(ok({ account, credentialCandidate: candidate }));
  expect(await invokeProvider(a, "refresh", { credential }, options)).toEqual(
    ok({ credentialCandidate: candidate }),
  );
  expect(
    await invokeProvider(
      a,
      "listResources",
      { credential, cursor: "page-one", limit: 50 },
      options,
    ),
  ).toEqual(ok(resources));
  expect(await invokeProvider(a, "check", { credential }, options)).toEqual(ok(check));
  expect(await invokeProvider(a, "disconnect", { credential }, options)).toEqual(
    ok({ remoteStatus: "revoked" }),
  );
  expect(await invokeProvider(a, "discoverCapabilities", {}, options)).toEqual(ok(capabilities));
});

test("capability discovery cannot advertise an adapter operation declared unsupported", async () => {
  const a = fixture();
  a.operations.refresh = { mode: "unsupported" };
  expect(
    await invokeProvider(a, "discoverCapabilities", {}, { signal: new AbortController().signal }),
  ).toEqual(err({ code: "invalid_response" }));
});

test("read-only discovery cannot claim an ambiguous external mutation outcome", async () => {
  const a = fixture();
  a.operations.discoverCapabilities = {
    mode: "supported",
    run: () => Promise.resolve(err({ code: "ambiguous_outcome" })),
  };
  expect(
    await invokeProvider(a, "discoverCapabilities", {}, { signal: new AbortController().signal }),
  ).toEqual(err({ code: "invalid_response" }));
});

test("declared ambiguous external outcomes remain explicit and receive no automatic retry", async () => {
  const a = fixture();
  const run = vi.fn(() => Promise.resolve(err({ code: "ambiguous_outcome" as const })));
  a.operations.disconnect = { mode: "supported", run };
  expect(
    await invokeProvider(a, "disconnect", { credential }, { signal: new AbortController().signal }),
  ).toEqual(err({ code: "ambiguous_outcome", outcome: "unknown" }));
  expect(run).toHaveBeenCalledTimes(1);
});

test("timeout distinguishes a possibly applied remote revocation from read-only discovery", async () => {
  vi.useFakeTimers();
  const a = fixture();
  a.operations.disconnect = { mode: "supported", run: async () => new Promise(() => {}) };
  a.operations.discoverCapabilities = { mode: "supported", run: async () => new Promise(() => {}) };
  const options = { signal: new AbortController().signal, timeoutMs: 10 };
  const disconnect = invokeProvider(a, "disconnect", { credential }, options);
  const discovery = invokeProvider(a, "discoverCapabilities", {}, options);
  await vi.advanceTimersByTimeAsync(10);
  expect(await disconnect).toEqual(err({ code: "timed_out", outcome: "unknown" }));
  expect(await discovery).toEqual(err({ code: "timed_out" }));
  expect(vi.getTimerCount()).toBe(0);
});
