"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { guardCsrf } from "@/features/identity/actions/shared";
import type { DealCreateInput } from "./schemas";

export type CreateDealResult =
  | { ok: true; deal: { id: string; updatedAt: string } | null }
  | { ok: false; error: { id: string } };

// Retired native entry: an old page lacks durable operation identity. Keep CSRF
// first and fail closed before context/domain effects; new pages use the strict V1 action.
// MCP/import continue to use the separate shared createDeal domain service.
export async function createDealAction(
  _input: DealCreateInput,
  csrfToken: string | null = null,
): Promise<CreateDealResult> {
  const csrf = await guardCsrf(csrfToken);
  return {
    ok: false,
    error: { id: csrf.ok ? ERROR_IDS.DEAL_CREATE_INPUT_INVALID : "E_AUTH_CSRF" },
  };
}
