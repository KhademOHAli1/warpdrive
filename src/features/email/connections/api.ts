import { z } from "zod";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  checkedMailboxSchema,
  mailboxConnectionErrorSchema,
  mailboxViewSchema,
} from "./apiSchemas";
import type {
  CheckMailboxInput,
  MailboxConnectionError,
  MailboxConnectionMutation,
  MailboxConnectionResult,
  SaveMailboxInput,
} from "./types";

function responseFailure(status: number): MailboxConnectionError {
  if (status === 401) return "permission";
  if (status === 403) return "fresh_auth_required";
  if (status === 429) return "rate_limit";
  return "unknown";
}

async function request<T>(
  path: "check" | "save" | "mutate" | "list",
  schema: z.ZodType<T>,
  signal: AbortSignal,
  body?: unknown,
): Promise<MailboxConnectionResult<T>> {
  signal.throwIfAborted();
  const csrf = body === undefined ? null : readCsrfToken();
  if (body !== undefined && (csrf === null || csrf === ""))
    return { ok: false, error: "permission" };
  let response: Response;
  try {
    response = await fetch(`/api/mail-connections/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    signal.throwIfAborted();
    return { ok: false, error: "network" };
  }
  signal.throwIfAborted();
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    signal.throwIfAborted();
    return { ok: false, error: responseFailure(response.status) };
  }
  signal.throwIfAborted();
  const parsed = z
    .discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), value: schema }),
      z.object({ ok: z.literal(false), error: mailboxConnectionErrorSchema }),
    ])
    .safeParse(raw);
  if (!parsed.success || (!response.ok && parsed.data.ok))
    return { ok: false, error: responseFailure(response.status) };
  return parsed.data;
}

export function checkMailboxConnection(input: CheckMailboxInput, signal: AbortSignal) {
  return request("check", checkedMailboxSchema, signal, input);
}

export function saveMailboxConnection(input: SaveMailboxInput, signal: AbortSignal) {
  return request("save", mailboxViewSchema, signal, input);
}

export function mutateMailboxConnection(
  accountId: string,
  action: MailboxConnectionMutation,
  signal: AbortSignal,
) {
  return request(
    "mutate",
    z
      .unknown()
      .optional()
      .transform(() => undefined),
    signal,
    { accountId, action },
  );
}

export function listMailboxConnections(signal: AbortSignal) {
  return request("list", z.array(mailboxViewSchema).max(1000), signal);
}
