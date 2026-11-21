import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { canonicalUuidSchema } from "@/features/agency-projects/valueSchemas";
import { boundedBody } from "@/features/billing/http";
import type { ProjectFailure, ProjectResult } from "../contracts";

export class ProjectApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const statuses: Record<ProjectFailure, number> = {
  project_unavailable: 404,
  project_forbidden: 403,
  project_invalid: 400,
  project_conflict: 409,
};

export function returned<T>(result: ProjectResult<T>): T {
  if (!result.ok) throw new ProjectApiError(statuses[result.error], result.error);
  return result.value;
}

export function parsed<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ProjectApiError(400, "invalid_input");
  return result.data;
}

export function key(value: unknown) {
  return parsed(canonicalUuidSchema, value);
}

export function intent(request: Request) {
  const value = request.headers.get("Idempotency-Key");
  return value === null ? randomUUID() : key(value);
}

export function missing(): never {
  throw new ProjectApiError(404, "not_found");
}

export function methodNotAllowed(): never {
  throw new ProjectApiError(405, "method_not_allowed");
}

export async function body(request: Request, signal: AbortSignal): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    throw new ProjectApiError(415, "content_type_required");
  try {
    return JSON.parse(await boundedBody(request, 65_536, signal)) as unknown;
  } catch {
    signal.throwIfAborted();
    throw new ProjectApiError(400, "invalid_json");
  }
}

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export function apiJson(value: unknown, status = 200, extra?: Record<string, string>) {
  return value === undefined
    ? new Response(null, { status, headers: { ...headers, ...extra } })
    : Response.json(value, { status, headers: { ...headers, ...extra } });
}

export function apiPage<T>(url: URL, rows: T[]) {
  const rawLimit = url.searchParams.get("per_page") ?? "100";
  if (!/^\d{1,3}$/.test(rawLimit)) throw new ProjectApiError(400, "invalid_page");
  const limit = Number(rawLimit);
  if (limit < 1 || limit > 100) throw new ProjectApiError(400, "invalid_page");
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? null : /^(\d{1,3})\.(\d{1,8})\.([01])$/.exec(rawCursor);
  if (rawCursor !== null && (cursor === null || Number(cursor[1]) !== limit))
    throw new ProjectApiError(400, "invalid_cursor");
  const page = cursor === null ? 0 : Number(cursor[2]);
  const start = page * limit;
  const previous = page > 0;
  const next = start + limit < rows.length;
  return apiJson({
    results: rows.slice(start, start + limit),
    next_cursor: next ? `${limit}.${page + 1}.0` : null,
    prev_cursor: previous ? `${limit}.${page - 1}.1` : null,
    next_page_results: next,
    prev_page_results: previous,
    total_count: rows.length,
    total_results: rows.length,
    total_pages: Math.ceil(rows.length / limit),
    count: Math.max(0, Math.min(limit, rows.length - start)),
  });
}
