import type { SecurityStatus } from "@/features/auth/better/contracts";
import type { Result } from "@/types/result";
import type { IdentityCommand } from "../identityPersistence";
import type { readOwnPrivacyRequestAction } from "../requestActions";

type ReadOutcome = Awaited<ReturnType<typeof readOwnPrivacyRequestAction>>;
export type OwnCaseStatus = Extract<ReadOutcome, { ok: true }>["value"];
export type OwnCaseFailure = Extract<ReadOutcome, { ok: false }>["error"] | "transport_interrupted";
export type OwnPrivacyCaseStatusProps = {
  caseId: string;
  securityStatus: SecurityStatus;
  refreshSecurity: (signal: AbortSignal) => Promise<Result<SecurityStatus | null, "unavailable">>;
};
export type OwnCaseView = {
  caseId: string;
  data: OwnCaseStatus | null;
  error: OwnCaseFailure | null;
  busy: boolean;
  recorded: boolean;
  command: IdentityCommand | null;
};
export const canConfirmOwnCase = (status: string) =>
  status === "received" || status === "verification_needed";

export function emptyOwnCase(caseId: string, fresh: boolean): OwnCaseView {
  return {
    caseId,
    data: null,
    error: fresh ? null : "fresh_auth_required",
    busy: fresh,
    recorded: false,
    command: null,
  };
}
