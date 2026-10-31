import { assert, expect, test } from "vitest";
import { invokeProvider } from "@/features/integrations/providers/invoke";
import { err } from "@/types/result";
import { attemptA, harness, redirectUri, signal } from "./fakeProviderTestFixtures";

async function requestConsent(requestedScopes?: string[]) {
  const h = harness();
  const result = await invokeProvider(
    h.adapter,
    "authorize",
    { attemptId: attemptA, state: "synthetic-scope-state", redirectUri, requestedScopes },
    { signal: signal() },
  );
  assert(result.ok);
  return h;
}

test.each([
  { label: "empty", requestedScopes: [] },
  { label: "read-only subset", requestedScopes: ["synthetic.read"] },
  { label: "revoke-only subset", requestedScopes: ["synthetic.revoke"] },
])(
  "explicit $label scopes remain exact through exchange, binding and check",
  async ({ requestedScopes }) => {
    const h = await requestConsent(requestedScopes);
    const approval = h.approve(attemptA, "account-a", signal());
    assert(approval.ok);
    const exchanged = await invokeProvider(
      h.adapter,
      "exchange",
      { attemptId: attemptA, code: approval.value.code, redirectUri },
      { signal: signal() },
    );
    assert(exchanged.ok);
    expect(exchanged.value.credentialCandidate.grantedScopes).toEqual(requestedScopes);
    const bound = h.bindCredential(exchanged.value.credentialCandidate);
    assert(bound.ok);
    const checked = await invokeProvider(
      h.adapter,
      "check",
      { credential: bound.value },
      { signal: signal() },
    );
    assert(checked.ok);
    expect(checked.value.grantedScopes).toEqual(requestedScopes);
  },
);

test("omitting scope selection uses the fixture account default rather than explicit-empty semantics", async () => {
  const h = await requestConsent();
  const approval = h.approve(attemptA, "account-a", signal());
  assert(approval.ok);
  const exchanged = await invokeProvider(
    h.adapter,
    "exchange",
    { attemptId: attemptA, code: approval.value.code, redirectUri },
    { signal: signal() },
  );
  assert(exchanged.ok);
  expect(exchanged.value.credentialCandidate.grantedScopes).toEqual([
    "synthetic.read",
    "synthetic.revoke",
  ]);
});

test("unsupported scopes reject consent without silently dropping the unsupported request", async () => {
  const h = await requestConsent(["synthetic.read", "synthetic.unsupported"]);
  expect(h.approve(attemptA, "account-a", signal())).toEqual(err({ code: "forbidden" }));
  expect(
    await invokeProvider(
      h.adapter,
      "exchange",
      { attemptId: attemptA, code: "synthetic:unissued-code", redirectUri },
      { signal: signal() },
    ),
  ).toEqual(err({ code: "invalid_input" }));
});

test("a substituted redirect cannot consume an explicitly empty-scope consent code", async () => {
  const h = await requestConsent([]);
  const approval = h.approve(attemptA, "account-a", signal());
  assert(approval.ok);
  const exchange = (redirect: string) =>
    invokeProvider(
      h.adapter,
      "exchange",
      { attemptId: attemptA, code: approval.value.code, redirectUri: redirect },
      { signal: signal() },
    );
  expect(await exchange("https://wrong-fixture.invalid/callback")).toEqual(
    err({ code: "invalid_input" }),
  );
  const bound = await exchange(redirectUri);
  assert(bound.ok);
  expect(bound.value.credentialCandidate.grantedScopes).toEqual([]);
});
