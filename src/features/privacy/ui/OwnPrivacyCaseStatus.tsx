"use client";

import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { FreshVerification } from "@/features/auth/ui/FreshVerification";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import { privacyRequestMessagesForLocale } from "../privacyRequestMessages";
import type {
  OwnCaseFailure,
  OwnCaseStatus,
  OwnPrivacyCaseStatusProps,
} from "./ownCaseStatusModel";
import { useOwnPrivacyCaseStatus } from "./useOwnPrivacyCaseStatus";

export type { OwnPrivacyCaseStatusProps } from "./ownCaseStatusModel";

type CaseMessages = ReturnType<typeof privacyRequestMessagesForLocale>;
type CaseTask = ReturnType<typeof useOwnPrivacyCaseStatus>;

function errorText(error: OwnCaseFailure, L: CaseMessages) {
  switch (error) {
    case "forbidden":
    case "not_found":
    case "invalid_input":
      return L.caseUnavailable;
    case "fresh_auth_required":
      return L.caseFreshRequired;
    case "stale_version":
      return L.caseChanged;
    case "idempotency_conflict":
      return L.caseConflict;
    case "evidence_unavailable":
      return L.errors.evidence_unavailable;
    case "case_not_mutable":
      return L.errors.case_not_mutable;
    case "csrf_rejected":
      return L.errors.csrf_rejected;
    case "requester_changed":
      return L.caseAccountChanged;
    case "storage_unavailable":
    case "request_failed":
    case "transport_interrupted":
      return L.caseLoadFailed;
  }
}

function CaseDetails({ row, L }: { row: OwnCaseStatus; L: CaseMessages }) {
  const format = useFormatters();
  const kinds: Record<string, string | undefined> = L.kinds;
  const states: Record<string, string | undefined> = L.caseStates;
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="text-muted-foreground">{L.reference}</dt>
        <dd>
          <bdi dir="ltr">{row.id}</bdi>
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{L.kind}</dt>
        <dd>{kinds[row.kind] ?? L.caseUnknownKind}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{L.caseState}</dt>
        <dd>{states[row.status] ?? L.caseUnknownState}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{L.receivedAt}</dt>
        <dd>
          <time dateTime={new Date(row.receivedAt).toISOString()}>
            {format.dateTime(row.receivedAt)}
          </time>
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{L.caseDueAt}</dt>
        <dd>
          {row.dueAt === null ? (
            L.caseNoDeadline
          ) : (
            <time dateTime={new Date(row.dueAt).toISOString()}>{format.dateTime(row.dueAt)}</time>
          )}
        </dd>
      </div>
    </dl>
  );
}

function CaseControls({ task, L }: { task: CaseTask; L: CaseMessages }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={task.busy} onClick={task.refresh}>
          {L.caseRefresh}
        </Button>
        {task.canConfirm && (
          <Button disabled={task.busy} onClick={task.confirm}>
            {task.busy
              ? L.caseWorking
              : task.command === null
                ? L.caseConfirm
                : L.caseRetryConfirmation}
          </Button>
        )}
      </div>
      {task.canConfirm && <p className="text-sm text-muted-foreground">{L.caseConfirmHelp}</p>}
    </>
  );
}

export function OwnPrivacyCaseStatus(props: OwnPrivacyCaseStatusProps) {
  const locale = useLocale();
  const L = privacyRequestMessagesForLocale(locale);
  const task = useOwnPrivacyCaseStatus(props);
  const row = task.data;
  const uncertain =
    task.command !== null &&
    !task.recorded &&
    ["storage_unavailable", "request_failed", "transport_interrupted"].includes(task.error ?? "");
  return (
    <SettingsCard className={`${BLOCK_CLASS} ph-no-capture`}>
      <SettingsCardHeader title={L.caseTitle} description={L.caseDescription} />
      <SettingsCardBody className="space-y-4">
        {task.blocked !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {task.blocked === "signed_out" ? L.workspaceSignedOut : L.caseAccountChanged}
          </p>
        ) : (
          <div className="space-y-4" dir={directionForLocale(locale)}>
            {task.busy && (
              <p role="status" className="text-sm text-muted-foreground">
                {task.command === null ? L.caseLoading : L.caseWorking}
              </p>
            )}
            {task.error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {uncertain ? L.caseConfirmationPending : errorText(task.error, L)}
              </p>
            )}
            {task.recorded && (
              <p role="status" className="text-sm">
                {L.caseConfirmationRecorded}
              </p>
            )}
            {row !== null ? (
              <CaseDetails row={row} L={L} />
            ) : !task.busy && task.error === null ? (
              <p className="text-sm text-muted-foreground">{L.caseNotLoaded}</p>
            ) : null}
            <CaseControls task={task} L={L} />
            {task.error === "fresh_auth_required" && (
              <FreshVerification
                status={props.securityStatus}
                refresh={task.confirmFreshIdentity}
                providerConfirmation="new_tab"
                embedded
              />
            )}
          </div>
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}
