"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { agencyProjectsTranslator } from "./agencyProjectsMessages";
import type { ProjectWorkspaceSummaryProps } from "./projectWorkspaceTypes";
import { useProjectStartSubmission } from "./useProjectStartSubmission";

export type {
  ProjectStartOutcome,
  ProjectWorkspaceDraft,
  ProjectWorkspaceSummaryProps,
} from "./projectWorkspaceTypes";

const PRIVATE = `${BLOCK_CLASS} ph-no-capture`;
const stateMessages = {
  planned: "statePlanned",
  active: "stateActive",
  "on-hold": "stateOnHold",
  completed: "stateCompleted",
  canceled: "stateCanceled",
  archived: "stateArchived",
} as const;

export function ProjectWorkspaceSummary(props: ProjectWorkspaceSummaryProps) {
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const project = props.project;
  const available =
    props.canRead &&
    props.contextKey.trim().length > 0 &&
    props.draft.contextKey === props.contextKey &&
    project !== null &&
    props.draft.input.projectId === project.id &&
    (props.draft.attempt === null || props.draft.attempt.projectId === project.id) &&
    props.ownerLabel !== null &&
    props.ownerLabel.trim().length > 0 &&
    props.contextLabel !== null &&
    props.contextLabel.trim().length > 0;
  if (!available) {
    return (
      <p role="alert" className={PRIVATE}>
        {t("workspaceUnavailable")}
      </p>
    );
  }
  // Losing read/context permission unmounts private content and aborts its pending requests.
  return <ProjectWorkspaceContent key={`${props.contextKey}:${project.id}`} {...props} />;
}

function ProjectWorkspaceContent(props: ProjectWorkspaceSummaryProps) {
  const id = useId();
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const submission = useProjectStartSubmission(props);
  const project = props.project;
  if (project === null) return null;
  const error = {
    idle: null,
    submitting: null,
    unknown: t("startUnknown"),
    rejected: t("startRejected"),
    unavailable: t("startUnavailable"),
    conflict: t("startConflict"),
    started: null,
  }[submission.kind];
  const pending = submission.kind === "submitting";
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={`${PRIVATE} space-y-4`}
      dir={directionForLocale(preferences.locale)}
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {t("workspaceHeading")}
      </h2>
      <dl className="space-y-2">
        <div>
          <dt className="text-sm text-muted-foreground">{t("projectName")}</dt>
          <dd>
            <bdi>{project.title}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("internalOwner")}</dt>
          <dd>
            <bdi>{props.ownerLabel}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("linkedContext")}</dt>
          <dd>
            <bdi>{props.contextLabel}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("workspaceState")}</dt>
          <dd>
            {submission.readStale ? t("workspaceRefreshNeeded") : t(stateMessages[project.state])}
          </dd>
        </div>
      </dl>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {submission.refreshUnavailable && <p role="alert">{t("refreshUnavailable")}</p>}
      {pending && <p role="status">{t("startSubmitting")}</p>}
      {submission.kind === "started" && <p role="status">{t("startConfirmed")}</p>}
      {submission.refreshing && <p role="status">{t("refreshPending")}</p>}
      {submission.canSubmit && (
        <Button
          type="button"
          disabled={pending || submission.refreshing}
          onClick={submission.submit}
        >
          {submission.kind === "unknown" ? t("checkStartRequest") : t("startWork")}
        </Button>
      )}
      {(submission.kind === "conflict" || submission.readStale) && (
        <Button type="button" disabled={submission.refreshing} onClick={submission.refresh}>
          {t("refreshProject")}
        </Button>
      )}
    </section>
  );
}
