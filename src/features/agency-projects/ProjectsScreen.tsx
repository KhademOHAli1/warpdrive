"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { readCsrfToken } from "@/utils/csrfCookie";
import { enableAgencyProjectsAction, listAgencyProjectsAction } from "./actions";
import { agencyProjectsTranslator } from "./agencyProjectsMessages";
import { ProjectCreatePanel } from "./ProjectCreatePanel";
import { ProjectListView } from "./ProjectListView";
import { ProjectWorkspaceScreen } from "./ProjectWorkspaceScreen";
import { type ProjectListRequest, projectListRequestSchema } from "./persistence/projectListInput";
import { type ProjectListViewState, projectListUiPage } from "./projectListUiTypes";

export type ProjectsScreenProps = {
  actorId: string;
  actorName: string;
  enabled: boolean;
  canEnable: boolean;
  canCreate: boolean;
};
export function ProjectsScreen(props: ProjectsScreenProps) {
  return props.enabled ? (
    <EnabledProjects key={props.actorId} {...props} />
  ) : (
    <DisabledProjects {...props} />
  );
}
function DisabledProjects(props: ProjectsScreenProps) {
  const { locale, numberingSystem } = useLocalePreferences();
  const t = agencyProjectsTranslator(locale, numberingSystem);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function enable() {
    setPending(true);
    try {
      const result = await enableAgencyProjectsAction(props.actorId, true, readCsrfToken());
      if (result.ok) router.refresh();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="space-y-4">
      <h1 className="text-display font-[450]">{t("screen.title")}</h1>
      <p>{t("screen.disabled")}</p>
      {props.canEnable && (
        <Button
          disabled={pending}
          onClick={() => {
            void enable();
          }}
        >
          {pending ? t("screen.enabling") : t("screen.enable")}
        </Button>
      )}
      {failed && <p role="alert">{t("screen.error")}</p>}
    </section>
  );
}
function EnabledProjects(props: ProjectsScreenProps) {
  const { locale, numberingSystem } = useLocalePreferences();
  const t = agencyProjectsTranslator(locale, numberingSystem);
  const [request, setRequest] = useState<ProjectListRequest>(() =>
    projectListRequestSchema.parse({ filters: { schemaVersion: 1 } }),
  );
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<ProjectListViewState | null>(null);
  const [requestId, setRequestId] = useState("initial");
  const [selected, setSelected] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const id = `${reload}:${++generation.current}`;
    let alive = true;
    setRequestId(id);
    setView({ kind: "loading", contextKey: props.actorId, requestId: id, request });
    void listAgencyProjectsAction(props.actorId, request)
      .then((result) => {
        if (!alive) return;
        setView(
          result.ok
            ? {
                kind: "ready",
                contextKey: props.actorId,
                requestId: id,
                request,
                page: projectListUiPage(result.value),
              }
            : {
                kind: "error",
                contextKey: props.actorId,
                requestId: id,
                request,
                error: result.error,
              },
        );
      })
      .catch(() => {
        if (alive)
          setView({
            kind: "error",
            contextKey: props.actorId,
            requestId: id,
            request,
            error: "unknown",
          });
      });
    return () => {
      alive = false;
    };
  }, [props.actorId, request, reload]);
  return (
    <div className={`${BLOCK_CLASS} ph-no-capture space-y-6`}>
      <h1 className="text-display font-[450]">{t("screen.title")}</h1>
      {selected !== null && (
        <>
          <Button variant="outline" onClick={() => setSelected(null)}>
            {t("screen.back")}
          </Button>
          <ProjectWorkspaceScreen
            key={`${props.actorId}:${selected}`}
            actorId={props.actorId}
            projectId={selected}
            onChanged={() => setReload((value) => value + 1)}
          />
        </>
      )}
      <div className={selected === null ? "grid gap-8 xl:grid-cols-2" : "hidden"}>
        {props.canCreate && (
          <ProjectCreatePanel
            actorId={props.actorId}
            actorName={props.actorName}
            onCreated={(id) => {
              setSelected(id);
              setReload((value) => value + 1);
            }}
          />
        )}
        <ProjectListView
          canRead
          contextKey={props.actorId}
          requestId={requestId}
          request={request}
          view={view}
          onRequestChange={setRequest}
          onRetry={() => setReload((value) => value + 1)}
          onOpenProject={setSelected}
        />
      </div>
    </div>
  );
}
