"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/primitives/select";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { agencyProjectsTranslator } from "./agencyProjectsMessages";
import type { ProjectCreationFormProps } from "./projectCreationUiTypes";
import { useProjectCreationSubmission } from "./useProjectCreationSubmission";

export type {
  ProjectCreationAttempt,
  ProjectCreationDraft,
  ProjectCreationFormProps,
  ProjectCreationOutcome,
} from "./projectCreationUiTypes";

const PRIVATE = `${BLOCK_CLASS} ph-no-capture`;

export function ProjectCreationForm(props: ProjectCreationFormProps) {
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const available =
    props.canCreate &&
    props.contextKey.length > 0 &&
    props.draft.contextKey === props.contextKey &&
    props.contextLabel !== null &&
    props.contextLabel.trim().length > 0 &&
    props.owners.length > 0 &&
    props.owners.every((owner) => owner.id.length > 0 && owner.label.trim().length > 0) &&
    new Set(props.owners.map((owner) => owner.id.toLowerCase())).size === props.owners.length;
  if (!available)
    return (
      <p role="alert" className={PRIVATE}>
        {t("unavailableContext")}
      </p>
    );
  // A context/permission loss unmounts all private fields, portals and pending work.
  return <ProjectCreationFields key={props.contextKey} {...props} />;
}

function ProjectCreationFields(props: ProjectCreationFormProps) {
  const id = useId();
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const submission = useProjectCreationSubmission(props);
  const { state, draft, locked } = submission;
  const selectedOwner = props.owners.find(
    (owner) => owner.id.toLowerCase() === draft.input.ownerUserId.toLowerCase(),
  );
  const error = {
    idle: null,
    invalid: t("invalidInput"),
    submitting: null,
    unknown: submission.retryUnavailable
      ? t("outcomeUnknownRetryUnavailable")
      : t("outcomeUnknown"),
    rejected: t("rejected"),
    unavailable: t("serviceUnavailable"),
    created: null,
  }[state.kind];
  const pending = state.kind === "submitting";
  const created = state.kind === "created";
  return (
    <form
      noValidate
      aria-labelledby={`${id}-heading`}
      className={`${PRIVATE} space-y-4`}
      dir={directionForLocale(preferences.locale)}
      onSubmit={(event) => {
        event.preventDefault();
        submission.submit();
      }}
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {t("createProject")}
      </h2>
      <p className="text-sm text-muted-foreground">
        <bdi>{props.contextLabel}</bdi>
      </p>
      <div className="space-y-1">
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          {t("projectName")}
        </label>
        <Input
          id={`${id}-title`}
          value={draft.input.title}
          maxLength={320}
          disabled={locked}
          aria-invalid={state.invalidTitle}
          aria-describedby={error === null ? undefined : `${id}-error`}
          onChange={(event) => submission.edit({ title: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label id={`${id}-owner-label`} htmlFor={`${id}-owner`} className="text-sm font-medium">
          {t("internalOwner")}
        </label>
        <Select
          value={selectedOwner?.id ?? ""}
          disabled={locked}
          dir={directionForLocale(preferences.locale)}
          onValueChange={(ownerUserId) => submission.edit({ ownerUserId })}
        >
          <SelectTrigger
            id={`${id}-owner`}
            aria-labelledby={`${id}-owner-label`}
            aria-invalid={state.invalidOwner}
            aria-describedby={error === null ? undefined : `${id}-error`}
            className={`${PRIVATE} w-full`}
          >
            <SelectValue placeholder={t("internalOwner")} />
          </SelectTrigger>
          <SelectContent className={PRIVATE}>
            {props.owners.map((owner) => (
              <SelectItem key={owner.id} value={owner.id}>
                <bdi>{owner.label}</bdi>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error !== null && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {(pending || created) && (
        <p role="status">{pending ? t("submitting") : t("confirmedSuccess")}</p>
      )}
      <Button type="submit" disabled={pending || created || submission.retryUnavailable}>
        {state.kind === "unknown" ? t("retrySameRequest") : t("createProject")}
      </Button>
    </form>
  );
}
