"use client";

import {
  CalendarDays,
  Columns3,
  GanttChartSquare,
  List,
  Plus,
  Table2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { useDirection } from "@/components/ui/direction";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import { ProjectItemArchiveControl } from "../automations/ProjectItemArchiveControl";
import { projectCoverPath } from "../brand/contracts";
import { ProjectBrandMark, ProjectCoverArt } from "../brand/ProjectBrand";
import type {
  ProjectCommands,
  ProjectItem,
  ProjectMemberGrant,
  ProjectPriority,
  ProjectResult,
  ProjectWorkflowState,
  ProjectWorkspace,
} from "../contracts";
import {
  emptyPlanningViewFilters,
  matchesPlanningItemScope,
  type PlanningSavedView,
  type PlanningScope,
  sortPlanningViewItems,
  type WorkspacePlanning,
} from "../planning/contracts";
import { planningPath } from "../planning/paths";
import { ProjectCalendar } from "./layouts/ProjectCalendar";
import { ProjectSpreadsheet } from "./layouts/ProjectSpreadsheet";
import { ProjectTimeline } from "./layouts/ProjectTimeline";
import { filterProjectItems, ProjectItemFilters } from "./ProjectItemFilters";
import { ProjectItemPlanning } from "./ProjectItemPlanning";
import { ProjectMembers } from "./ProjectMembers";
import { ProjectWriteNotice } from "./ProjectTitleDialog";
import { ProjectWorkItemCreate } from "./ProjectWorkItemCreate";
import { ProjectWorkItemPeek } from "./ProjectWorkItemPeek";
import {
  type ProjectItemChanges,
  ProjectWorkItemBoard,
  ProjectWorkItemList,
} from "./ProjectWorkItems";
import { ProjectWorkspaceNav } from "./ProjectWorkspaceNav";
import {
  handleLayoutChange,
  type ProjectWorkspaceLocation,
  resolveProjectView,
} from "./planeWorkItemView";
import { projectsTranslator } from "./projectMessages";
import { workflowStateLabel } from "./projectWorkflowUi";
import type { WorkItemGroup } from "./projectWorkItemGroups";
import { useProjectWrites } from "./projectWrites";

export function InternalProjectWorkspace({
  initial,
  initialLocation,
  initialPlanning,
  reloadPlanning,
  writePlanning,
  savedView,
  planningScope,
  actorId,
  commands,
  locale,
}: {
  initial: ProjectWorkspace;
  initialLocation?: ProjectWorkspaceLocation;
  initialPlanning?: WorkspacePlanning;
  reloadPlanning?: (projectId: string) => Promise<ProjectResult<WorkspacePlanning>>;
  writePlanning?: (
    projectId: string,
    itemId: string,
    patch: { cycleId?: string | null; moduleIds?: string[] },
  ) => Promise<ProjectResult<WorkspacePlanning>>;
  savedView?: PlanningSavedView;
  planningScope?: PlanningScope;
  actorId?: string;
  commands: ProjectCommands;
  locale: Locale;
}) {
  const { numberingSystem } = useLocalePreferences();
  const direction = useDirection();
  const labels = projectsTranslator(locale, numberingSystem);
  const [workspace, setWorkspace] = useState(initial);
  const [location, setLocation] = useState<ProjectWorkspaceLocation>(
    () => initialLocation ?? { view: "list", itemId: null },
  );
  const [filters, setFilters] = useState(savedView?.filters ?? emptyPlanningViewFilters);
  const [planning, setPlanning] = useState(initialPlanning);
  const itemTrigger = useRef<HTMLElement | null>(null);
  const { execute, error, pending } = useProjectWrites();
  const projectId = workspace.project.id;

  useEffect(() => {
    if (initialLocation === undefined) return;
    function syncLocation() {
      const query = new URLSearchParams(window.location.search);
      setLocation({
        view: resolveProjectView(query.get("view") ?? savedView?.layout ?? null),
        itemId: query.get("item"),
      });
    }
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, [initialLocation, savedView?.layout]);

  function moveLocation(next: ProjectWorkspaceLocation) {
    setLocation(next);
    if (initialLocation === undefined) return;
    const url = new URL(window.location.href);
    if (next.view === (savedView?.layout ?? "list")) url.searchParams.delete("view");
    else url.searchParams.set("view", next.view);
    if (next.itemId === null) url.searchParams.delete("item");
    else url.searchParams.set("item", next.itemId);
    window.history.replaceState(null, "", url);
  }

  function updateItem(item: ProjectItem, changes: ProjectItemChanges, report = true) {
    return execute(
      () =>
        commands.updateItem({ projectId, itemId: item.id, revision: item.revision, ...changes }),
      setWorkspace,
      report,
    );
  }

  function setMember(userId: string, membership: ProjectMemberGrant | null) {
    return execute(() => commands.setMember({ projectId, userId, membership }), setWorkspace);
  }

  const defaultState = workspace.states.find(({ isDefault }) => isDefault);
  function createItem(
    state: ProjectWorkflowState | undefined,
    entry?: { dueDate?: string; priority?: ProjectPriority } | "column",
  ) {
    if (!workspace.canEdit || state === undefined || planningScope?.group.acceptsWork === false)
      return null;
    const binding =
      planningScope === undefined
        ? undefined
        : {
            [planningScope.kind === "cycles" ? "cycleId" : "moduleId"]: planningScope.group.id,
          };
    const compact = entry !== undefined;
    const date = typeof entry === "object" ? (entry.dueDate ?? null) : null;
    const priority = typeof entry === "object" ? entry.priority : undefined;
    return (
      <ProjectWorkItemCreate
        workspace={workspace}
        stateId={state.id}
        dueDate={date}
        priority={priority}
        labels={labels}
        pending={pending}
        trigger={
          <Button
            variant={compact ? "ghost" : "default"}
            size={compact ? "sm" : "md"}
            aria-label={
              compact
                ? `${date ?? (priority === undefined ? workflowStateLabel(state, labels) : labels(`priority.${priority}`))} · ${labels("workspace.create")}`
                : undefined
            }
            disabled={pending}
          >
            <Plus aria-hidden="true" className="size-4" />
            {compact ? null : labels("workspace.create")}
          </Button>
        }
        submit={(draft, id) =>
          execute(
            async () => {
              const created = await commands.createItem({
                projectId,
                id,
                ...draft,
                planning: binding,
              });
              if (created.ok && binding !== undefined && reloadPlanning !== undefined) {
                const next = await reloadPlanning(projectId).catch(() => null);
                if (next?.ok === true) setPlanning(next.value);
              }
              return created;
            },
            setWorkspace,
            false,
          )
        }
      />
    );
  }

  const scopedFilters =
    planningScope === undefined
      ? filters
      : {
          ...filters,
          [planningScope.kind === "cycles" ? "cycleId" : "moduleId"]: planningScope.group.id,
        };
  const items = sortPlanningViewItems(
    filterProjectItems(workspace, scopedFilters, locale, planning).filter(({ stateId }) => {
      const category = workspace.states.find(({ id }) => id === stateId)?.category;
      return matchesPlanningItemScope(savedView?.display.itemScope ?? "all", category);
    }),
    savedView?.display.orderBy ?? "manual",
  );
  const activeItem = workspace.items.find(({ id }) => id === location.itemId);
  const activeCategory = workspace.states.find(({ id }) => id === activeItem?.stateId)?.category;
  const canArchiveActive =
    workspace.canEdit && (activeCategory === "completed" || activeCategory === "cancelled");
  function createBoardItem({ state, priority, related }: WorkItemGroup) {
    if (related !== undefined || (savedView?.display.subGroupBy ?? "none") !== "none") return null;
    return createItem(state ?? defaultState, priority === undefined ? "column" : { priority });
  }
  function setItemPlanning(
    itemId: string,
    patch: { cycleId?: string | null; moduleIds?: string[] },
  ) {
    if (writePlanning !== undefined)
      void execute(() => writePlanning(projectId, itemId, patch), setPlanning);
  }
  const workItemsProps = {
    workspace: { ...workspace, items },
    display: savedView?.display,
    planning,
    setItemPlanning,
    labels,
    pending,
    updateItem,
    openItem: (id: string, trigger: HTMLElement) => {
      itemTrigger.current = trigger;
      moveLocation({ ...location, itemId: id });
    },
  };
  const noMatches =
    (workspace.items.length > 0 || planningScope !== undefined) && items.length === 0 ? (
      <p role="status" className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        {labels("workspace.noMatches")}
      </p>
    ) : null;
  return (
    <section className={`${BLOCK_CLASS} ph-no-capture`}>
      {(workspace.project.cover || workspace.project.logo) && (
        <div className="relative mb-3">
          <ProjectCoverArt
            cover={workspace.project.cover}
            imageSrc={
              workspace.project.cover?.kind === "image"
                ? projectCoverPath(projectId, workspace.project.cover.value)
                : undefined
            }
            className={workspace.project.cover ? "h-20 rounded-lg border sm:h-28" : "hidden"}
          />
          {workspace.project.logo && (
            <ProjectBrandMark
              logo={workspace.project.logo}
              className={workspace.project.cover ? "absolute bottom-3 start-3" : undefined}
            />
          )}
        </div>
      )}
      <PageHeading
        title={workspace.project.title}
        crumbs={[
          { label: labels("index.title"), href: "/projects/internal" },
          { label: workspace.project.title },
        ]}
        description={
          workspace.project.archived
            ? labels("sections.archived")
            : workspace.settings.description || undefined
        }
        actions={createItem(defaultState)}
      />
      <ProjectWorkspaceNav
        projectId={projectId}
        active="work_items"
        canManageSettings={workspace.canManageSettings}
        intakeEnabled={workspace.settings.intakeEnabled}
        restrictedGuest={workspace.guestAccess === "restricted"}
      />
      <ProjectWorkspaceContext
        projectId={projectId}
        planningScope={planningScope}
        savedView={savedView}
        locale={locale}
      />
      <ProjectWriteNotice error={error} labels={labels} />
      <Tabs
        value={location.view}
        onValueChange={(value) =>
          handleLayoutChange(value, location.view, (view) => moveLocation({ view, itemId: null }))
        }
        dir={direction}
        className="gap-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList
            aria-label={labels("workspace.views")}
            className="h-auto w-fit flex-wrap gap-1 rounded-md border bg-card p-1"
          >
            <TabsTrigger value="list" className={PILL_TAB}>
              <List aria-hidden="true" className="size-4" />
              {labels("workspace.list")}
            </TabsTrigger>
            <TabsTrigger value="board" className={PILL_TAB}>
              <Columns3 aria-hidden="true" className="size-4" />
              {labels("workspace.board")}
            </TabsTrigger>
            <TabsTrigger value="calendar" className={PILL_TAB}>
              <CalendarDays aria-hidden="true" className="size-4" />
              {labels("layout.calendar")}
            </TabsTrigger>
            <TabsTrigger value="gantt_chart" className={PILL_TAB}>
              <GanttChartSquare aria-hidden="true" className="size-4" />
              {labels("layout.timeline")}
            </TabsTrigger>
            <TabsTrigger value="spreadsheet" className={PILL_TAB}>
              <Table2 aria-hidden="true" className="size-4" />
              {labels("layout.spreadsheet")}
            </TabsTrigger>
            <TabsTrigger value="members" className={PILL_TAB}>
              <Users aria-hidden="true" className="size-4" />
              {labels("workspace.members")}
            </TabsTrigger>
          </TabsList>
          {location.view !== "members" && savedView?.locked !== true && (
            <ProjectItemFilters
              workspace={workspace}
              filters={filters}
              planning={planning}
              planningScope={planningScope}
              change={setFilters}
              labels={labels}
            />
          )}
        </div>
        <TabsContent value="list">
          {noMatches ?? <ProjectWorkItemList {...workItemsProps} />}
        </TabsContent>
        <TabsContent value="board">
          {noMatches ?? (
            <ProjectWorkItemBoard {...workItemsProps} createInColumn={createBoardItem} />
          )}
        </TabsContent>
        <TabsContent value="calendar">
          {noMatches ?? (
            <ProjectCalendar
              {...workItemsProps}
              createOnDay={(dueDate) => createItem(defaultState, { dueDate })}
            />
          )}
        </TabsContent>
        <TabsContent value="gantt_chart">
          {noMatches ?? <ProjectTimeline {...workItemsProps} />}
        </TabsContent>
        <TabsContent value="spreadsheet">
          {noMatches ?? <ProjectSpreadsheet {...workItemsProps} />}
        </TabsContent>
        <TabsContent value="members">
          <ProjectMembers
            workspace={workspace}
            labels={labels}
            pending={pending}
            setMember={setMember}
            actorId={actorId}
            onGuestInvited={(person) =>
              setWorkspace((current) => ({
                ...current,
                members: [
                  ...current.members.filter((member) => member.person.id !== person.id),
                  {
                    person,
                    role: "guest",
                    canAssign: false,
                    invitationPending: true,
                    projectsGuestOnly: true,
                  },
                ],
              }))
            }
          />
        </TabsContent>
      </Tabs>
      {activeItem !== undefined && (
        <ProjectWorkItemPeek
          item={activeItem}
          workspace={workspace}
          labels={labels}
          pending={pending}
          updateItem={updateItem}
          planning={
            planning !== undefined && actorId !== undefined ? (
              <ProjectItemPlanning
                key={activeItem.id}
                projectId={projectId}
                itemId={activeItem.id}
                actorId={actorId}
                canEdit={workspace.canEdit}
                planning={planning}
                change={setPlanning}
                labels={labels}
              />
            ) : undefined
          }
          lifecycle={
            canArchiveActive && actorId !== undefined ? (
              <ProjectItemArchiveControl
                actorId={actorId}
                projectId={projectId}
                item={activeItem}
                disabled={pending}
                onChanged={() => {
                  setWorkspace((current) => ({
                    ...current,
                    items: current.items.filter(({ id }) => id !== activeItem.id),
                  }));
                  moveLocation({ ...location, itemId: null });
                }}
              />
            ) : undefined
          }
          close={() => moveLocation({ ...location, itemId: null })}
          restoreFocus={() => {
            const trigger = itemTrigger.current;
            if (trigger?.isConnected !== true) return false;
            trigger.focus();
            return true;
          }}
        />
      )}
    </section>
  );
}

function ProjectWorkspaceContext({
  projectId,
  planningScope,
  savedView,
  locale,
}: {
  projectId: string;
  planningScope?: PlanningScope;
  savedView?: PlanningSavedView;
  locale: Locale;
}) {
  const { numberingSystem } = useLocalePreferences();
  const labels = projectsTranslator(locale, numberingSystem);
  return (
    <>
      {planningScope !== undefined && (
        <div className="mb-3">
          <Link
            href={planningPath(projectId, planningScope.kind, planningScope.group.id)}
            className="inline-flex rounded-md border bg-card px-2.5 py-1 text-sm hover:bg-accent"
          >
            <bdi>{planningScope.group.title}</bdi>
          </Link>
        </div>
      )}
      {savedView !== undefined && (
        <div className="mb-3 flex items-center gap-2">
          <Badge variant="secondary">
            <bdi>{savedView.title}</bdi>
          </Badge>
          <Link
            href={`/projects/internal/${projectId}`}
            aria-label={labels("planning.closeSavedView")}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-7")}
          >
            <X aria-hidden="true" className="size-4" />
          </Link>
        </div>
      )}
    </>
  );
}
