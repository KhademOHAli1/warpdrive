"use client";
import { useEffect, useRef, useState } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { readAgencyProjectAction, startAgencyProjectAction } from "./actions";
import { agencyProjectsTranslator } from "./agencyProjectsMessages";
import { ProjectWorkspaceSummary } from "./ProjectWorkspaceSummary";
import type { ProjectWorkspaceDraft } from "./projectWorkspaceTypes";

type Workspace = Extract<
  Awaited<ReturnType<typeof readAgencyProjectAction>>,
  { ok: true }
>["value"];
export function ProjectWorkspaceScreen(props: {
  actorId: string;
  projectId: string;
  onChanged: () => void;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const t = agencyProjectsTranslator(locale, numberingSystem);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<ProjectWorkspaceDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const contextKey = `${props.actorId}:${props.projectId}`;
  async function refresh(signal: AbortSignal) {
    const current = ++generation.current;
    const result = await readAgencyProjectAction(props.actorId, props.projectId);
    signal.throwIfAborted();
    if (!alive.current || current !== generation.current)
      return { ok: false as const, error: "unavailable" as const };
    if (!result.ok) {
      setWorkspace(null);
      setFailed(true);
      return { ok: false as const, error: "unavailable" as const };
    }
    setWorkspace(result.value);
    setFailed(false);
    setDraft((previous) =>
      previous !== null && previous.attempt !== null
        ? previous
        : {
            contextKey,
            input: {
              projectId: props.projectId,
              expectedRevision: result.value.project.revision,
              intentId: crypto.randomUUID(),
            },
            attempt: null,
          },
    );
    return { ok: true as const, value: undefined };
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    const current = ++generation.current;
    void readAgencyProjectAction(props.actorId, props.projectId)
      .then((result) => {
        if (!alive.current || controller.signal.aborted || current !== generation.current) return;
        if (!result.ok) {
          setFailed(true);
          return;
        }
        setWorkspace(result.value);
        setDraft({
          contextKey,
          input: {
            projectId: props.projectId,
            expectedRevision: result.value.project.revision,
            intentId: crypto.randomUUID(),
          },
          attempt: null,
        });
      })
      .catch(() => {
        if (alive.current && !controller.signal.aborted) setFailed(true);
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [props.actorId, props.projectId, contextKey]);
  if (failed) return <p role="alert">{t("workspaceUnavailable")}</p>;
  if (workspace === null || draft === null) return <p role="status">{t("screen.loading")}</p>;
  return (
    <ProjectWorkspaceSummary
      contextKey={contextKey}
      draft={draft}
      project={workspace.project}
      ownerLabel={workspace.ownerLabel}
      contextLabel={workspace.contextLabel}
      canRead
      canStart={workspace.canStart}
      onDraftChange={setDraft}
      start={async (input, signal) => {
        signal.throwIfAborted();
        const result = await startAgencyProjectAction(props.actorId, input, readCsrfToken());
        signal.throwIfAborted();
        return result;
      }}
      refresh={refresh}
      onStarted={() => {
        props.onChanged();
      }}
    />
  );
}
