import { assert, expect, test } from "vitest";
import { invokeProvider } from "@/features/integrations/providers/invoke";
import { err } from "@/types/result";
import {
  attemptA,
  attemptB,
  connect,
  consent,
  harness,
  redirectUri,
  signal,
} from "./fakeProviderTestFixtures";

test("a reusable fixture completes all seven contracts without a real provider", async () => {
  const h = harness();
  const c = await connect(h);
  expect(new URL(c.authorizationUrl).hostname).toBe("fake-provider.invalid");
  expect(c.candidate.accessToken).toMatch(/^synthetic:/);
  const options = { signal: signal() };
  const check = await invokeProvider(h.adapter, "check", { credential: c.credential }, options);
  assert(check.ok);
  expect(check.value).toMatchObject({ accountId: "account-a", checkedAt: 1_000 });
  const page = await invokeProvider(
    h.adapter,
    "listResources",
    { credential: c.credential, limit: 2 },
    options,
  );
  assert(page.ok);
  expect(page.value.resources).toHaveLength(2);
  const discovery = await invokeProvider(h.adapter, "discoverCapabilities", {}, options);
  assert(discovery.ok);
  expect(discovery.value.operations).toHaveLength(7);
  const refreshed = await invokeProvider(
    h.adapter,
    "refresh",
    { credential: c.credential },
    options,
  );
  assert(refreshed.ok);
  const bound = h.bindCredential(refreshed.value.credentialCandidate);
  assert(bound.ok);
  expect(
    await invokeProvider(h.adapter, "disconnect", { credential: bound.value }, options),
  ).toEqual({
    ok: true,
    value: { remoteStatus: "revoked" },
  });
});

test("consent, code, attempt and redirect bindings reject replay or substitution", async () => {
  const h = harness();
  const approved = await consent(h);
  const options = { signal: signal() };
  expect(
    await invokeProvider(
      h.adapter,
      "exchange",
      {
        attemptId: attemptB,
        code: approved.code,
        redirectUri,
      },
      options,
    ),
  ).toEqual(err({ code: "invalid_input" }));
  expect(
    await invokeProvider(
      h.adapter,
      "exchange",
      {
        attemptId: attemptA,
        code: approved.code,
        redirectUri: "https://other-fixture.invalid/callback",
      },
      options,
    ),
  ).toEqual(err({ code: "invalid_input" }));
  const exchange = () =>
    invokeProvider(
      h.adapter,
      "exchange",
      {
        attemptId: attemptA,
        code: approved.code,
        redirectUri,
      },
      options,
    );
  expect((await exchange()).ok).toBe(true);
  expect(await exchange()).toEqual(err({ code: "authorization_expired" }));
  expect(h.approve(attemptA, "account-b", signal())).toEqual(err({ code: "invalid_input" }));
});

test("refresh rotates a family and stale or forged generations cannot use or bind it", async () => {
  const h = harness();
  const c = await connect(h);
  const options = { signal: signal() };
  const r = await invokeProvider(h.adapter, "refresh", { credential: c.credential }, options);
  assert(r.ok);
  expect(h.bindCredential(c.candidate)).toEqual(err({ code: "authorization_expired" }));
  expect(await invokeProvider(h.adapter, "refresh", { credential: c.credential }, options)).toEqual(
    err({ code: "authorization_expired" }),
  );
  const bound = h.bindCredential(r.value.credentialCandidate);
  assert(bound.ok);
  expect(bound.value.id).toBe(c.credential.id);
  expect(bound.value.generation).toBe(c.credential.generation + 1);
  expect(
    await invokeProvider(
      h.adapter,
      "check",
      {
        credential: { ...bound.value, generation: 999 },
      },
      options,
    ),
  ).toEqual(err({ code: "authorization_expired" }));
  expect((await invokeProvider(h.adapter, "check", { credential: bound.value }, options)).ok).toBe(
    true,
  );
});

test("pages remain bound to account and grant generation", async () => {
  const h = harness();
  const a = await connect(h);
  const b = await connect(h, "account-b", attemptB);
  const options = { signal: signal() };
  const first = await invokeProvider(
    h.adapter,
    "listResources",
    { credential: a.credential, limit: 2 },
    options,
  );
  assert(first.ok);
  const cursor = first.value.nextCursor;
  assert(cursor !== undefined);
  expect(
    await invokeProvider(h.adapter, "listResources", { credential: b.credential, cursor }, options),
  ).toEqual(err({ code: "invalid_input" }));
  const next = await invokeProvider(
    h.adapter,
    "listResources",
    { credential: a.credential, cursor },
    options,
  );
  assert(next.ok);
  expect(next.value.resources.map((r) => r.name)).toEqual(["account-a resource 3"]);
  expect(next.value.nextCursor).toBeUndefined();
  const refreshed = await invokeProvider(
    h.adapter,
    "refresh",
    { credential: a.credential },
    options,
  );
  assert(refreshed.ok);
  const bound = h.bindCredential(refreshed.value.credentialCandidate);
  assert(bound.ok);
  expect(
    await invokeProvider(h.adapter, "listResources", { credential: bound.value, cursor }, options),
  ).toEqual(err({ code: "invalid_input" }));
});

test("identical labels/account IDs/attempts in isolated instances cannot cross-bind credentials or codes", async () => {
  const left = harness();
  const right = harness();
  const a = await connect(left);
  const b = await connect(right);
  expect(a.candidate.accessToken).not.toBe(b.candidate.accessToken);
  expect(a.credential.id).not.toBe(b.credential.id);
  expect(right.bindCredential(a.candidate)).toEqual(err({ code: "authorization_expired" }));
  expect(
    await invokeProvider(
      right.adapter,
      "check",
      { credential: a.credential },
      { signal: signal() },
    ),
  ).toEqual(err({ code: "authorization_expired" }));
  expect(
    await invokeProvider(
      right.adapter,
      "exchange",
      {
        attemptId: attemptA,
        code: a.code,
        redirectUri,
      },
      { signal: signal() },
    ),
  ).toEqual(err({ code: "invalid_input" }));
});
