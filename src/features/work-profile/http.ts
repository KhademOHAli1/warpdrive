import { z } from "zod";
import type { Result } from "@/types/result";
import type { WorkError } from "./contracts";
export const workJson = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
export const workFailure = (code: WorkError["code"], id?: string) =>
  workJson(
    { ok: false, error: { code, ...(id !== undefined && id !== "" ? { id } : {}) } },
    {
      forbidden: 403,
      unauthorized: 401,
      fresh_auth_required: 401,
      invalid_input: 400,
      conflict: 409,
      not_found: 404,
      preview_stale: 409,
      replay_conflict: 409,
      in_use: 409,
      unavailable: 503,
      rate_limited: 429,
    }[code],
  );
export function workResult<T>(result: Result<T, WorkError>): Response {
  return result.ok
    ? workJson({ ok: true, data: result.value })
    : workFailure(result.error.code, result.error.id);
}
export const querySchema = z
  .object({
    typeId: z.string().uuid().optional(),
    stageId: z.string().uuid().optional(),
    q: z.string().trim().max(200).optional(),
    archived: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    cursor: z.string().uuid().optional(),
  })
  .strict();
