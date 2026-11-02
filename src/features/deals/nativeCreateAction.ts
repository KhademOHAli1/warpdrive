"use server";

import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { createNativeDeal, readNativeDealCreation } from "./nativeCreate";
import type { NativeDealCreateResult } from "./nativeCreateTypes";

// A distinct strict entry: an operation can never fall through to the legacy action.
export async function createNativeDealAction(
  raw: unknown,
  csrfToken: string | null,
): Promise<NativeDealCreateResult> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, error: { id: "E_AUTH_CSRF" }, outcome: "unresolved" };
  const context = await createContext();
  if (context.session === null || context.actor === null)
    return { ok: false, error: { id: "E_AUTH_003" }, outcome: "unresolved" };
  return createNativeDeal(db, context.session, raw, SIG());
}

// Strict read-only recovery; this entry can never create on a missing receipt.
export async function readNativeDealCreationAction(
  raw: unknown,
  csrfToken: string | null,
): Promise<NativeDealCreateResult> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, error: { id: "E_AUTH_CSRF" }, outcome: "unresolved" };
  const context = await createContext();
  if (context.session === null || context.actor === null)
    return { ok: false, error: { id: "E_AUTH_003" }, outcome: "unresolved" };
  return readNativeDealCreation(db, context.session, raw, SIG());
}
