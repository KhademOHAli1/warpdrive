import { ERROR_IDS } from "@/constants/errorIds";
import type { PermSetUser } from "@/features/permissions/effective";
import type { CompanyFailure } from "./contracts";

export function companyCapabilities(actor: PermSetUser) {
  const active = actor.isActive;
  return {
    manageProfile:
      active &&
      (actor.type === "admin" ||
        actor.flags.has("company.profile.manage") ||
        actor.flags.has("permissions.manage")),
    manageLegal: active && (actor.type === "admin" || actor.flags.has("company.legal.manage")),
  };
}
const errorIds = {
  unauthorized: ERROR_IDS.COMPANY_DENIED,
  fresh_auth_required: ERROR_IDS.COMPANY_DENIED,
  forbidden: ERROR_IDS.COMPANY_DENIED,
  invalid_input: ERROR_IDS.COMPANY_INPUT_INVALID,
  conflict: ERROR_IDS.COMPANY_CONFLICT,
  not_found: ERROR_IDS.COMPANY_NOT_FOUND,
  storage_unavailable: ERROR_IDS.COMPANY_STORAGE_UNAVAILABLE,
  asset_invalid: ERROR_IDS.COMPANY_ASSET_INVALID,
  provider_unavailable: ERROR_IDS.COMPANY_PROVIDER_UNAVAILABLE,
  replay_conflict: ERROR_IDS.COMPANY_REPLAY_CONFLICT,
  write_failed: ERROR_IDS.COMPANY_WRITE_FAILED,
  rate_limited: ERROR_IDS.COMPANY_DENIED,
};
export const companyFailure = (code: CompanyFailure["code"]): CompanyFailure => ({
  code,
  id: errorIds[code],
});
