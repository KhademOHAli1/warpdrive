"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { err, ok, type Result } from "@/types/result";
import { verifyOwnPrivacyIdentity } from "./identitySelf";
import { createOwnPrivacyCase, readOwnPrivacyCase } from "./selfService";

type RequestFailure =
  | "csrf_rejected"
  | "fresh_auth_required"
  | "requester_changed"
  | "request_failed"
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "idempotency_conflict"
  | "storage_unavailable"
  | "stale_version"
  | "evidence_unavailable"
  | "case_not_mutable";

type OwnRequestOperation<T> = (
  ...args: Parameters<typeof createOwnPrivacyCase>
) => Promise<Result<T, unknown>>;

const requesterIdSchema = z.uuid();
function expectedRequester(value: unknown): Result<string, "invalid_input"> {
  const parsed = requesterIdSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err("invalid_input");
}

function boundedFailure(value: unknown): RequestFailure {
  switch (value) {
    case "invalid_input":
    case "forbidden":
    case "not_found":
    case "idempotency_conflict":
    case "storage_unavailable":
    case "stale_version":
    case "evidence_unavailable":
    case "case_not_mutable":
      return value;
    default:
      return "request_failed";
  }
}

async function runOwnRequest<T>(
  csrfToken: string | null,
  input: unknown,
  operation: OwnRequestOperation<T>,
  requesterGuard?: { expectedId: unknown },
): Promise<Result<T, RequestFailure>> {
  const signal = SIG();
  try {
    const csrf = await guardCsrf(csrfToken);
    signal.throwIfAborted();
    if (!csrf.ok) return err("csrf_rejected");
    const expected =
      requesterGuard === undefined ? ok(null) : expectedRequester(requesterGuard.expectedId);
    if (!expected.ok) return expected;
    const requestHeaders = await headers();
    signal.throwIfAborted();
    const current = await resolveWorkflowSession(db, requestHeaders, signal, {
      requireFresh: true,
    });
    signal.throwIfAborted();
    if (current === null) return err("fresh_auth_required");
    // This selector can only deny a stale form; it never supplies the authorized actor.
    if (expected.value !== null && expected.value !== current.user.id)
      return err("requester_changed");
    // The service owns strict command validation and current transaction-level authorization.
    const result = await operation(
      db,
      { userId: current.user.id, sessionId: current.session.id },
      input,
      signal,
    );
    signal.throwIfAborted();
    return result.ok ? result : err(boundedFailure(result.error));
  } catch (cause) {
    signal.throwIfAborted();
    if (
      typeof cause === "object" &&
      cause !== null &&
      "name" in cause &&
      cause.name === "AbortError"
    )
      throw cause;
    return err("request_failed");
  }
}

export async function createOwnPrivacyRequestAction(
  csrfToken: string | null,
  input: unknown,
  expectedRequesterId: unknown,
) {
  return runOwnRequest(csrfToken, input, createOwnPrivacyCase, { expectedId: expectedRequesterId });
}

export async function readOwnPrivacyRequestAction(csrfToken: string | null, input: unknown) {
  return runOwnRequest(csrfToken, input, readOwnPrivacyCase);
}

export async function verifyOwnPrivacyRequestAction(csrfToken: string | null, input: unknown) {
  return runOwnRequest(csrfToken, input, verifyOwnPrivacyIdentity);
}
