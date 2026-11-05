import { z } from "zod";
import { readCsrfToken } from "@/utils/csrfCookie";

const envelope = z.object({ ok: z.literal(true), data: z.unknown() });
const failure = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    id: z.string().optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  }),
});

export class ProfileApiError extends Error {
  constructor(
    readonly code: string,
    readonly id?: string,
  ) {
    super(code);
  }
}

export async function profileRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  command?: unknown,
): Promise<T> {
  const multipart = command instanceof FormData;
  const response = await fetch(url, {
    method: command === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    signal,
    ...(command === undefined
      ? {}
      : {
          headers: {
            ...(multipart ? {} : { "Content-Type": "application/json" }),
            "x-csrf-token": readCsrfToken() ?? "",
          },
          body: multipart ? command : JSON.stringify(command),
        }),
  });
  const body: unknown = await response.json();
  const rejected = failure.safeParse(body);
  if (rejected.success) throw new ProfileApiError(rejected.data.error.code, rejected.data.error.id);
  const success = envelope.safeParse(body);
  if (!response.ok || !success.success) throw new ProfileApiError("unavailable");
  const result = schema.safeParse(success.data.data);
  if (!result.success) throw new ProfileApiError("unavailable");
  return result.data;
}

export function restored<T>(key: string, schema: z.ZodType<T>): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    const result = schema.safeParse(data);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function remember(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage may be disabled. The in-memory command remains retryable. */
  }
}

export function forget(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* In-memory state remains authoritative. */
  }
}
