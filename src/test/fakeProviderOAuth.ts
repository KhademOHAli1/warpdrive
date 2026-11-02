import type {
  ProviderFailure,
  ProviderInput,
  ProviderOutput,
} from "@/features/integrations/providers/contract";
import { err, ok, type Result } from "@/types/result";
import { FAKE_CODE_TTL_MS, FAKE_REFRESH_TTL_MS } from "./fakeProviderModels";
import type { FakeProviderState } from "./fakeProviderState";

export function authorize(state: FakeProviderState, input: ProviderInput<"authorize">) {
  if (state.attempts.has(input.attemptId)) return err({ code: "invalid_input" as const });
  state.attempts.set(input.attemptId, {
    state: input.state,
    redirectUri: input.redirectUri,
    scopes: input.requestedScopes === undefined ? undefined : [...input.requestedScopes],
    expiresAt: state.now + FAKE_CODE_TTL_MS,
    approved: false,
  });
  const url = new URL("https://fake-provider.invalid/authorize");
  url.searchParams.set("attempt", input.attemptId);
  url.searchParams.set("state", input.state);
  return ok({ authorizationUrl: url.toString() });
}

export function approve(
  state: FakeProviderState,
  attemptId: string,
  accountId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const attempt = state.attempts.get(attemptId);
  const account = state.accounts.get(accountId);
  if (attempt === undefined || account === undefined || attempt.approved)
    return err({ code: "invalid_input" as const });
  if (attempt.expiresAt <= state.now) return err({ code: "authorization_expired" as const });
  if (attempt.scopes?.some((scope) => !account.scopes.includes(scope)) === true)
    return err({ code: "forbidden" as const });
  const code = state.synthetic("code");
  state.codes.set(code, { attemptId, accountId, expiresAt: attempt.expiresAt, consumed: false });
  attempt.approved = true;
  return ok({ code, state: attempt.state });
}

export function exchange(
  state: FakeProviderState,
  input: ProviderInput<"exchange">,
): Result<ProviderOutput<"exchange">, ProviderFailure> {
  const code = state.codes.get(input.code);
  const attempt = state.attempts.get(input.attemptId);
  if (
    code === undefined ||
    attempt === undefined ||
    code.attemptId !== input.attemptId ||
    attempt.redirectUri !== input.redirectUri
  )
    return err({ code: "invalid_input" });
  if (code.consumed || code.expiresAt <= state.now) return err({ code: "authorization_expired" });
  const account = state.accounts.get(code.accountId);
  if (account === undefined) return err({ code: "invalid_input" });
  code.consumed = true;
  const family = {
    id: state.id("family"),
    accountId: account.id,
    generation: 1,
    boundGeneration: 0,
    revoked: false,
    accessExpiresAt: state.now,
    refreshExpiresAt: state.now + FAKE_REFRESH_TTL_MS,
    // Omission selects this synthetic account's default; an explicit empty selection grants none.
    scopes: [...(attempt.scopes ?? account.scopes)],
  };
  state.families.set(family.id, family);
  return ok({
    account: { id: account.id, displayName: account.displayName },
    credentialCandidate: state.issue(family),
  });
}

export function refresh(state: FakeProviderState, input: ProviderInput<"refresh">) {
  const resolved = state.resolve(input.credential, true);
  if (!resolved.ok) return resolved;
  resolved.value.generation++;
  return ok({ credentialCandidate: state.issue(resolved.value) });
}
