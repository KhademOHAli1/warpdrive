"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  createProjectAction,
  createProjectItemAction,
  setProjectMemberAction,
  updateProjectItemAction,
} from "./actions";
import type { ProjectCommands, ProjectIndex, ProjectWorkspace } from "./contracts";
import { InternalProjectsList } from "./ui/InternalProjectsList";
import { InternalProjectWorkspace } from "./ui/InternalProjectWorkspace";
import type { ProjectWorkspaceLocation } from "./ui/planeWorkItemView";
import { projectsTranslator } from "./ui/projectMessages";

type Screen =
  | { screen: "index"; initial: ProjectIndex }
  | { screen: "workspace"; initial: ProjectWorkspace; location: ProjectWorkspaceLocation };

export function InternalProjectsClient(props: Screen & { actorId: string }) {
  const { locale } = useLocalePreferences();
  const { actorId } = props;
  const commands: ProjectCommands = {
    createProject: (input) => createProjectAction(actorId, input, readCsrfToken()),
    createItem: (input) => createProjectItemAction(actorId, input, readCsrfToken()),
    updateItem: (input) => updateProjectItemAction(actorId, input, readCsrfToken()),
    setMember: (input) => setProjectMemberAction(actorId, input, readCsrfToken()),
  };
  if (props.screen === "index") {
    return <InternalProjectsList initial={props.initial} locale={locale} commands={commands} />;
  }
  return (
    <InternalProjectWorkspace
      initial={props.initial}
      initialLocation={props.location}
      locale={locale}
      commands={commands}
    />
  );
}

export function InternalProjectsUnavailable() {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = projectsTranslator(locale, numberingSystem);
  return (
    <EmptyState
      className="rounded-lg border bg-card"
      title={labels("navigation.unavailable")}
      body={labels("errors.project_unavailable")}
    />
  );
}
