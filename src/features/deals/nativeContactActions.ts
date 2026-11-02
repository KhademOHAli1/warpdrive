"use server";

import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { createOrgAction, createPersonAction } from "@/features/contacts/actions";
import type { OrgCreateInput, PersonCreateInput } from "@/features/contacts/schemas";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";

type Denied = { ok: false; error: { id: string } };
async function actorDenial(
  expectedActorId: string,
  csrfToken: string | null,
): Promise<Denied | null> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const expected = z.string().uuid().safeParse(expectedActorId);
  if (!expected.success) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const context = await createContext();
  return context.actor?.id.toLowerCase() === expected.data.toLowerCase()
    ? null
    : { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
}

// Expected account is a precondition, never authority. The delegated action sees the
// same fixed request cookies/context and retains its own permission/validation checks.
// These contact sub-operations have no idempotency receipt: uncertainty is reconciled manually.
export async function createDealOrgAction(
  expectedActorId: string,
  input: OrgCreateInput,
  csrfToken: string | null,
) {
  return (
    (await actorDenial(expectedActorId, csrfToken)) ?? (await createOrgAction(input, csrfToken))
  );
}
export async function createDealPersonAction(
  expectedActorId: string,
  input: PersonCreateInput,
  csrfToken: string | null,
) {
  return (
    (await actorDenial(expectedActorId, csrfToken)) ?? (await createPersonAction(input, csrfToken))
  );
}
