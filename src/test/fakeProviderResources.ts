import type {
  ProviderFailure,
  ProviderInput,
  ProviderOutput,
} from "@/features/integrations/providers/contract";
import {
  providerOperationNames,
  providerResourceKinds,
} from "@/features/integrations/providers/models";
import { err, ok, type Result } from "@/types/result";
import type { FakeProviderState } from "./fakeProviderState";

export function listResources(
  state: FakeProviderState,
  input: ProviderInput<"listResources">,
): Result<ProviderOutput<"listResources">, ProviderFailure> {
  const resolved = state.resolve(input.credential);
  if (!resolved.ok) return resolved;
  const family = resolved.value;
  const cursor = input.cursor === undefined ? undefined : state.cursors.get(input.cursor);
  if (
    input.cursor !== undefined &&
    (cursor === undefined ||
      cursor.familyId !== family.id ||
      cursor.generation !== family.generation)
  )
    return err({ code: "invalid_input" });
  const account = state.accounts.get(family.accountId);
  if (account === undefined) return err({ code: "invalid_input" });
  const offset = cursor?.offset ?? 0;
  const resources = structuredClone(account.resources.slice(offset, offset + input.limit));
  if (offset + resources.length >= account.resources.length) return ok({ resources });
  const nextCursor = state.synthetic("cursor");
  state.cursors.set(nextCursor, {
    familyId: family.id,
    generation: family.generation,
    offset: offset + resources.length,
  });
  return ok({ resources, nextCursor });
}

export function check(state: FakeProviderState, input: ProviderInput<"check">) {
  const resolved = state.resolve(input.credential);
  return resolved.ok
    ? ok({
        accountId: resolved.value.accountId,
        checkedAt: state.now,
        grantedScopes: [...resolved.value.scopes],
      })
    : resolved;
}

export function disconnect(state: FakeProviderState, input: ProviderInput<"disconnect">) {
  const resolved = state.resolve(input.credential, true, true);
  if (!resolved.ok) return resolved;
  const remoteStatus = resolved.value.revoked ? ("already_invalid" as const) : ("revoked" as const);
  resolved.value.revoked = true;
  return ok({ remoteStatus });
}

export function discoverCapabilities(
  state: FakeProviderState,
  input: ProviderInput<"discoverCapabilities">,
) {
  if (input.credential !== undefined) {
    const resolved = state.resolve(input.credential);
    if (!resolved.ok) return resolved;
  }
  return ok({
    operations: [...providerOperationNames],
    resourceKinds: [...providerResourceKinds],
    upstreamScopes: [...new Set([...state.accounts.values()].flatMap((a) => a.scopes))],
    pagination: "cursor" as const,
  });
}
