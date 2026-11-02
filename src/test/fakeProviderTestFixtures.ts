import { assert } from "vitest";
import { invokeProvider } from "@/features/integrations/providers/invoke";
import { createFakeProvider } from "./fakeProvider";

export const attemptA = "10000000-0000-4000-8000-000000000001";
export const attemptB = "10000000-0000-4000-8000-000000000002";
export const redirectUri = "https://crm-fixture.invalid/callback";
export const signal = () => new AbortController().signal;
export function harness() {
  return createFakeProvider({
    label: "isolated-fixture",
    now: 1_000,
    accounts: ["account-a", "account-b"].map((id) => ({
      id,
      displayName: id === "account-a" ? "حساب آزمایشی" : "Testkonto",
      scopes: ["synthetic.read", "synthetic.revoke"],
      resources: [1, 2, 3].map((n) => ({
        id: `overlapping-resource-${n}`,
        name: `${id} resource ${n}`,
        kind: "channel" as const,
        selectable: true,
      })),
    })),
  });
}

export async function consent(
  h: ReturnType<typeof harness>,
  accountId = "account-a",
  attemptId = attemptA,
) {
  const authorized = await invokeProvider(
    h.adapter,
    "authorize",
    { attemptId, state: "synthetic-state", redirectUri },
    { signal: signal() },
  );
  assert(authorized.ok);
  const approval = h.approve(attemptId, accountId, signal());
  assert(approval.ok);
  return { ...approval.value, attemptId, authorizationUrl: authorized.value.authorizationUrl };
}

export async function connect(
  h: ReturnType<typeof harness>,
  accountId = "account-a",
  attemptId = attemptA,
) {
  const approved = await consent(h, accountId, attemptId);
  const exchanged = await invokeProvider(
    h.adapter,
    "exchange",
    { attemptId, code: approved.code, redirectUri },
    { signal: signal() },
  );
  assert(exchanged.ok);
  const bound = h.bindCredential(exchanged.value.credentialCandidate);
  assert(bound.ok);
  return { credential: bound.value, candidate: exchanged.value.credentialCandidate, ...approved };
}
